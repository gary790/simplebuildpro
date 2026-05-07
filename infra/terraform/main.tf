# ============================================================
# SimpleBuild Pro — Terraform Infrastructure
# Google Cloud Platform: Cloud Run, Cloud SQL, GCS, CDN, LB
# ============================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    bucket = "simplebuildpro-terraform-state"
    prefix = "terraform/state"
  }
}

# ─── Provider ──────────────────────────────────────────────
provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# ─── Variables ─────────────────────────────────────────────
variable "project_id" {
  description = "GCP Project ID"
  type        = string
  default     = "simplebuildpro"
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "us-central1"
}

variable "domain" {
  description = "Primary domain"
  type        = string
  default     = "simplebuildpro.com"
}

variable "environment" {
  description = "Environment (production, staging)"
  type        = string
  default     = "production"
}

# ─── Enable Required APIs ──────────────────────────────────
resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "compute.googleapis.com",
    "vpcaccess.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "dns.googleapis.com",
    "certificatemanager.googleapis.com",
    "storage.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}

# ─── VPC Network ──────────────────────────────────────────
resource "google_compute_network" "main" {
  name                    = "simplebuildpro-vpc"
  auto_create_subnetworks = false

  depends_on = [google_project_service.apis]
}

resource "google_compute_subnetwork" "main" {
  name          = "simplebuildpro-subnet"
  ip_cidr_range = "10.0.0.0/24"
  region        = var.region
  network       = google_compute_network.main.id

  secondary_ip_range {
    range_name    = "serverless-connector"
    ip_cidr_range = "10.8.0.0/28"
  }
}

# ─── Serverless VPC Connector (Cloud Run ↔ Cloud SQL) ─────
resource "google_vpc_access_connector" "connector" {
  name          = "simplebuildpro-connector"
  region        = var.region
  network       = google_compute_network.main.name
  ip_cidr_range = "10.8.0.0/28"
  min_instances = 2
  max_instances = 10

  depends_on = [google_project_service.apis]
}

# ─── Cloud SQL (PostgreSQL) ────────────────────────────────
resource "google_sql_database_instance" "main" {
  name             = "simplebuildpro-db"
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier              = "db-custom-2-8192" # 2 vCPU, 8 GB RAM
    availability_type = "REGIONAL"         # HA with failover

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      backup_retention_settings {
        retained_backups = 30
      }
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.main.id
    }

    database_flags {
      name  = "max_connections"
      value = "200"
    }

    database_flags {
      name  = "log_min_duration_statement"
      value = "1000" # Log queries > 1s
    }

    insights_config {
      query_insights_enabled  = true
      record_application_tags = true
    }

    maintenance_window {
      day  = 7 # Sunday
      hour = 4 # 4 AM UTC
    }
  }

  deletion_protection = true

  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "main" {
  name     = "simplebuildpro"
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "app" {
  name     = "simplebuildpro-app"
  instance = google_sql_database_instance.main.name
  password = random_password.db_password.result
}

resource "random_password" "db_password" {
  length  = 32
  special = true
}

# ─── Secret Manager ───────────────────────────────────────
locals {
  secrets = {
    "DATABASE_URL"          = "postgresql://${google_sql_user.app.name}:${random_password.db_password.result}@/${google_sql_database.main.name}?host=/cloudsql/${google_sql_database_instance.main.connection_name}"
    "JWT_SECRET"            = random_password.jwt_secret.result
    "STRIPE_SECRET_KEY"     = "placeholder-set-manually"
    "STRIPE_WEBHOOK_SECRET" = "placeholder-set-manually"
    "ANTHROPIC_API_KEY"     = "placeholder-set-manually"
    "NOVITA_API_KEY"        = "placeholder-set-manually"
  }
}

resource "random_password" "jwt_secret" {
  length  = 64
  special = true
}

resource "google_secret_manager_secret" "secrets" {
  for_each  = local.secrets
  secret_id = each.key

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "secrets" {
  for_each    = local.secrets
  secret      = google_secret_manager_secret.secrets[each.key].id
  secret_data = each.value
}

# ─── Artifact Registry ───────────────────────────────────
resource "google_artifact_registry_repository" "main" {
  location      = var.region
  repository_id = "simplebuildpro"
  format        = "DOCKER"

  cleanup_policies {
    id     = "keep-minimum-versions"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }

  depends_on = [google_project_service.apis]
}

# ─── Cloud Run Service Account ────────────────────────────
resource "google_service_account" "api" {
  account_id   = "simplebuildpro-api"
  display_name = "SimpleBuild Pro API Service"
}

resource "google_service_account" "web" {
  account_id   = "simplebuildpro-web"
  display_name = "SimpleBuild Pro Web Service"
}

# Grant API service account access to secrets
resource "google_secret_manager_secret_iam_member" "api_access" {
  for_each  = google_secret_manager_secret.secrets
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

# Grant API service account access to Cloud SQL
resource "google_project_iam_member" "api_cloudsql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.api.email}"
}

# Grant API service account access to GCS
resource "google_project_iam_member" "api_storage" {
  project = var.project_id
  role    = "roles/storage.admin"
  member  = "serviceAccount:${google_service_account.api.email}"
}

# ─── GCS Buckets ──────────────────────────────────────────
resource "google_storage_bucket" "assets" {
  name     = "simplebuildpro-assets"
  location = "US"

  uniform_bucket_level_access = true

  cors {
    origin          = ["https://simplebuildpro.com", "https://*.simplebuildpro.com"]
    method          = ["GET", "HEAD", "PUT", "POST", "DELETE"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  lifecycle_rule {
    condition { age = 365 }
    action { type = "SetStorageClass", storage_class = "NEARLINE" }
  }

  versioning { enabled = true }
}

resource "google_storage_bucket" "builds" {
  name     = "simplebuildpro-builds"
  location = "US"
  uniform_bucket_level_access = true

  lifecycle_rule {
    condition { age = 90 }
    action { type = "SetStorageClass", storage_class = "NEARLINE" }
  }
}

resource "google_storage_bucket" "deploys" {
  name     = "simplebuildpro-deploys"
  location = "US"
  uniform_bucket_level_access = true
}

resource "google_storage_bucket" "snapshots" {
  name     = "simplebuildpro-snapshots"
  location = "US"
  uniform_bucket_level_access = true

  lifecycle_rule {
    condition { age = 180 }
    action { type = "SetStorageClass", storage_class = "COLDLINE" }
  }
}

# Make deploy bucket publicly readable (for serving deployed sites)
resource "google_storage_bucket_iam_member" "deploys_public" {
  bucket = google_storage_bucket.deploys.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# ─── Cloud Run — API Service ─────────────────────────────
resource "google_cloud_run_v2_service" "api" {
  name     = "simplebuildpro-api"
  location = var.region

  template {
    service_account = google_service_account.api.email

    scaling {
      min_instance_count = 1
      max_instance_count = 50
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/simplebuildpro/api:latest"

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }
        cpu_idle = true
      }

      # Environment variables
      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }

      env {
        name  = "CORS_ORIGIN"
        value = "https://simplebuildpro.com"
      }

      # Secret references
      dynamic "env" {
        for_each = local.secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.secrets[env.key].secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        http_get {
          path = "/health/live"
          port = 8080
        }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 10
      }

      liveness_probe {
        http_get {
          path = "/health/live"
          port = 8080
        }
        period_seconds = 30
      }
    }

    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }

    timeout = "300s"
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [google_project_service.apis]
}

# Allow unauthenticated access to API (auth handled by JWT)
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  location = google_cloud_run_v2_service.api.location
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ─── Cloud Run — Web Service ─────────────────────────────
resource "google_cloud_run_v2_service" "web" {
  name     = "simplebuildpro-web"
  location = var.region

  template {
    service_account = google_service_account.web.email

    scaling {
      min_instance_count = 1
      max_instance_count = 20
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/simplebuildpro/web:latest"

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        cpu_idle = true
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "NEXT_PUBLIC_API_URL"
        value = "https://api.simplebuildpro.com"
      }

      env {
        name  = "NEXT_PUBLIC_APP_URL"
        value = "https://simplebuildpro.com"
      }

      startup_probe {
        http_get {
          path = "/"
          port = 3000
        }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 10
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service_iam_member" "web_public" {
  location = google_cloud_run_v2_service.web.location
  name     = google_cloud_run_v2_service.web.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ─── Global Load Balancer + CDN ──────────────────────────
# NEG for API
resource "google_compute_region_network_endpoint_group" "api_neg" {
  name                  = "simplebuildpro-api-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region

  cloud_run {
    service = google_cloud_run_v2_service.api.name
  }
}

# NEG for Web
resource "google_compute_region_network_endpoint_group" "web_neg" {
  name                  = "simplebuildpro-web-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region

  cloud_run {
    service = google_cloud_run_v2_service.web.name
  }
}

# Backend services
resource "google_compute_backend_service" "api" {
  name                  = "simplebuildpro-api-backend"
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"

  backend {
    group = google_compute_region_network_endpoint_group.api_neg.id
  }

  cdn_policy {
    cache_mode = "CACHE_ALL_STATIC"
    default_ttl = 3600
  }
}

resource "google_compute_backend_service" "web" {
  name                  = "simplebuildpro-web-backend"
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"

  backend {
    group = google_compute_region_network_endpoint_group.web_neg.id
  }

  cdn_policy {
    cache_mode  = "CACHE_ALL_STATIC"
    default_ttl = 300
  }
}

# URL Map — route api.simplebuildpro.com to API, everything else to Web
resource "google_compute_url_map" "main" {
  name            = "simplebuildpro-lb"
  default_service = google_compute_backend_service.web.id

  host_rule {
    hosts        = ["api.simplebuildpro.com"]
    path_matcher = "api"
  }

  path_matcher {
    name            = "api"
    default_service = google_compute_backend_service.api.id
  }
}

# SSL Certificate
resource "google_compute_managed_ssl_certificate" "main" {
  name = "simplebuildpro-ssl"

  managed {
    domains = [
      "simplebuildpro.com",
      "www.simplebuildpro.com",
      "api.simplebuildpro.com",
    ]
  }
}

# HTTPS Proxy
resource "google_compute_target_https_proxy" "main" {
  name             = "simplebuildpro-https-proxy"
  url_map          = google_compute_url_map.main.id
  ssl_certificates = [google_compute_managed_ssl_certificate.main.id]
}

# Global Forwarding Rule
resource "google_compute_global_forwarding_rule" "main" {
  name                  = "simplebuildpro-lb-rule"
  target                = google_compute_target_https_proxy.main.id
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.main.address
}

resource "google_compute_global_address" "main" {
  name = "simplebuildpro-ip"
}

# HTTP → HTTPS redirect
resource "google_compute_url_map" "http_redirect" {
  name = "simplebuildpro-http-redirect"

  default_url_redirect {
    https_redirect = true
    strip_query    = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  name    = "simplebuildpro-http-redirect-proxy"
  url_map = google_compute_url_map.http_redirect.id
}

resource "google_compute_global_forwarding_rule" "http_redirect" {
  name                  = "simplebuildpro-http-redirect-rule"
  target                = google_compute_target_http_proxy.redirect.id
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.main.address
}

# ─── Outputs ──────────────────────────────────────────────
output "api_url" {
  value = google_cloud_run_v2_service.api.uri
}

output "web_url" {
  value = google_cloud_run_v2_service.web.uri
}

output "lb_ip" {
  value = google_compute_global_address.main.address
}

output "db_connection" {
  value     = google_sql_database_instance.main.connection_name
  sensitive = true
}
