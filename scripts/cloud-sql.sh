#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# SimpleBuild Pro - Cloud SQL Setup & Backup Script
# ─────────────────────────────────────────────────────────────────────────────

set -e

PROJECT_ID="${GCP_PROJECT_ID:-simplebuildpro}"
REGION="${GCP_REGION:-us-central1}"
INSTANCE_NAME="simplebuildpro-db"
DB_NAME="simplebuildpro"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

CMD="${1:-help}"

case "$CMD" in
  create)
    echo -e "${BLUE}🗄️  Creating Cloud SQL Instance${NC}"
    echo "───────────────────────────────────────────────────"

    gcloud sql instances create "$INSTANCE_NAME" \
      --project="$PROJECT_ID" \
      --database-version=POSTGRES_16 \
      --region="$REGION" \
      --tier=db-custom-2-4096 \
      --storage-type=SSD \
      --storage-size=20GB \
      --storage-auto-increase \
      --availability-type=REGIONAL \
      --backup-start-time=03:00 \
      --maintenance-window-day=SUN \
      --maintenance-window-hour=04 \
      --deletion-protection \
      --database-flags=max_connections=200,log_min_duration_statement=1000 \
      --insights-config-query-insights-enabled \
      --insights-config-record-application-tags \
      --quiet

    echo -e "${GREEN}✅ Instance created${NC}"

    # Create database
    gcloud sql databases create "$DB_NAME" \
      --instance="$INSTANCE_NAME" \
      --project="$PROJECT_ID" \
      --quiet

    echo -e "${GREEN}✅ Database '$DB_NAME' created${NC}"

    # Set root password
    echo ""
    echo -n "Set postgres user password: "
    read -s DB_PASSWORD
    echo ""
    
    gcloud sql users set-password postgres \
      --instance="$INSTANCE_NAME" \
      --project="$PROJECT_ID" \
      --password="$DB_PASSWORD" \
      --quiet

    echo -e "${GREEN}✅ Password set${NC}"
    echo ""
    echo "Connection name:"
    gcloud sql instances describe "$INSTANCE_NAME" \
      --project="$PROJECT_ID" \
      --format="value(connectionName)"
    ;;

  backup)
    echo -e "${BLUE}💾 Creating On-Demand Backup${NC}"
    BACKUP_DESC="manual-$(date +%Y%m%d-%H%M%S)"
    
    gcloud sql backups create \
      --instance="$INSTANCE_NAME" \
      --project="$PROJECT_ID" \
      --description="$BACKUP_DESC" \
      --quiet

    echo -e "${GREEN}✅ Backup created: $BACKUP_DESC${NC}"
    ;;

  backups)
    echo -e "${BLUE}📋 Listing Backups${NC}"
    gcloud sql backups list \
      --instance="$INSTANCE_NAME" \
      --project="$PROJECT_ID" \
      --format="table(id,windowStartTime,status,type,description)"
    ;;

  restore)
    BACKUP_ID="${2:?Backup ID required}"
    echo -e "${RED}⚠️  Restoring from backup $BACKUP_ID${NC}"
    read -p "This will overwrite current data. Continue? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
      echo "Aborted."
      exit 0
    fi

    gcloud sql backups restore "$BACKUP_ID" \
      --restore-instance="$INSTANCE_NAME" \
      --project="$PROJECT_ID" \
      --quiet

    echo -e "${GREEN}✅ Restore initiated${NC}"
    ;;

  connect)
    echo -e "${BLUE}🔌 Starting Cloud SQL Proxy${NC}"
    CONNECTION_NAME=$(gcloud sql instances describe "$INSTANCE_NAME" \
      --project="$PROJECT_ID" \
      --format="value(connectionName)")
    
    echo "Connection: $CONNECTION_NAME"
    echo "Connect with: psql -h 127.0.0.1 -U postgres -d $DB_NAME"
    echo ""
    
    cloud-sql-proxy "$CONNECTION_NAME" --port 5432
    ;;

  status)
    echo -e "${BLUE}📊 Cloud SQL Instance Status${NC}"
    echo "───────────────────────────────────────────────────"
    gcloud sql instances describe "$INSTANCE_NAME" \
      --project="$PROJECT_ID" \
      --format="table(name,state,region,databaseVersion,settings.tier,settings.dataDiskSizeGb)"
    
    echo ""
    echo "Databases:"
    gcloud sql databases list \
      --instance="$INSTANCE_NAME" \
      --project="$PROJECT_ID" \
      --format="table(name,charset,collation)"
    ;;

  *)
    echo "Usage: $0 [create|backup|backups|restore <id>|connect|status]"
    echo ""
    echo "Commands:"
    echo "  create   - Create Cloud SQL instance and database"
    echo "  backup   - Create on-demand backup"
    echo "  backups  - List all backups"
    echo "  restore  - Restore from backup ID"
    echo "  connect  - Start Cloud SQL Proxy for local access"
    echo "  status   - Show instance status"
    ;;
esac
