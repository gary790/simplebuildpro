# SimpleBuild Pro — Incident Response Playbook

## Phase 5.3d: Security & Compliance

**Document Owner**: Engineering Team  
**Last Updated**: 2026-05-09  
**Review Cadence**: Quarterly

---

## 1. Incident Severity Levels

| Severity             | Definition                                  | Response Time | Example                                    |
| -------------------- | ------------------------------------------- | ------------- | ------------------------------------------ |
| **SEV-1 (Critical)** | Complete service outage or data breach      | 15 min        | API down, DB compromised, data leak        |
| **SEV-2 (High)**     | Major feature degraded, >10% users affected | 30 min        | Deploys failing, billing broken, auth down |
| **SEV-3 (Medium)**   | Minor feature degraded, <10% users affected | 2 hours       | Slow AI responses, preview intermittent    |
| **SEV-4 (Low)**      | Cosmetic/minor issue, workaround available  | 24 hours      | UI glitch, non-critical email delay        |

---

## 2. On-Call & Escalation

### Contact Chain

1. **Primary On-Call**: Check PagerDuty / GCP Alerting
2. **Engineering Lead**: @gary790
3. **GCP Support**: Premium Support ticket (if infrastructure)
4. **Security Team**: security@simplebuildpro.com (if data breach)

### Escalation Triggers

- SEV-1 not acknowledged in 15 min → auto-escalate to Eng Lead
- SEV-1 not mitigated in 1 hour → escalate to GCP Support
- Any data breach → immediate Security Team notification
- Customer PII exposed → Legal + DPO notification within 72 hours (GDPR Art. 33)

---

## 3. Incident Response Procedures

### 3.1 — API Service Down (SEV-1)

**Symptoms**: Health check failing, 5xx errors, connection timeouts

**Diagnostic Steps**:

```bash
# 1. Check Cloud Run status
gcloud run services describe simplebuildpro-api --region=us-central1 --project=simplebuildpro

# 2. Check recent revisions
gcloud run revisions list --service=simplebuildpro-api --region=us-central1 --limit=5

# 3. Check logs for errors
gcloud logging read "resource.type=cloud_run_revision AND severity>=ERROR AND resource.labels.service_name=simplebuildpro-api" --limit=50 --project=simplebuildpro

# 4. Check Cloud SQL connectivity
gcloud sql instances describe simplebuildpro-db --project=simplebuildpro

# 5. Check Redis
gcloud redis instances describe simplebuildpro-redis --region=us-central1 --project=simplebuildpro
```

**Mitigation**:

```bash
# Rollback to previous revision
gcloud run services update-traffic simplebuildpro-api \
  --to-revisions=PREVIOUS_REVISION=100 \
  --region=us-central1 --project=simplebuildpro

# Or force redeploy from known-good image
gcloud run deploy simplebuildpro-api \
  --image=us-central1-docker.pkg.dev/simplebuildpro/simplebuildpro/api:phase1 \
  --region=us-central1 --project=simplebuildpro
```

---

### 3.2 — Database Outage (SEV-1)

**Symptoms**: Connection timeouts, "ECONNREFUSED" in logs, health check DB status "error"

**Diagnostic Steps**:

```bash
# Check instance status
gcloud sql instances describe simplebuildpro-db --project=simplebuildpro --format="value(state)"

# Check connections
gcloud sql instances describe simplebuildpro-db --format="json(settings.ipConfiguration)"

# Check recent operations
gcloud sql operations list --instance=simplebuildpro-db --limit=10
```

**Mitigation**:

```bash
# Restart instance (if hung)
gcloud sql instances restart simplebuildpro-db --project=simplebuildpro

# Failover to replica (if configured)
gcloud sql instances failover simplebuildpro-db --project=simplebuildpro

# Point-in-time recovery (data corruption — last resort)
gcloud sql instances clone simplebuildpro-db simplebuildpro-db-recovery \
  --point-in-time="2026-05-09T00:00:00Z" --project=simplebuildpro
```

---

### 3.3 — Security Breach / Data Leak (SEV-1)

**Immediate Actions** (within 15 minutes):

1. **Contain**: Revoke compromised credentials immediately
2. **Isolate**: If API compromised, scale to 0 instances
3. **Preserve**: Do NOT delete logs — they are evidence
4. **Notify**: Security team + Engineering Lead

```bash
# Revoke all active sessions (rotate JWT secret)
echo -n "$(openssl rand -base64 48)" | gcloud secrets versions add simplebuildpro-jwt-secret --data-file=- --project=simplebuildpro

# Scale API to 0 (emergency isolation)
gcloud run services update simplebuildpro-api --max-instances=0 --region=us-central1 --project=simplebuildpro

# Block suspicious IPs via Cloud Armor
gcloud compute security-policies rules create 1000 \
  --security-policy=simplebuildpro-waf \
  --action=deny-403 \
  --src-ip-ranges="ATTACKER_IP/32" \
  --description="Incident response - blocked attacker"

# Export audit logs for forensics
gcloud logging read "resource.type=cloud_run_revision AND timestamp>=\"$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ)\"" \
  --project=simplebuildpro --format=json > /tmp/incident-logs-$(date +%Y%m%d).json
```

**GDPR Breach Notification** (within 72 hours if PII affected):

- Document: what data, how many users, what happened
- Notify: Data Protection Authority (if EU users affected)
- Notify: Affected users if high risk to their rights

---

### 3.4 — Redis Cache Failure (SEV-2)

**Symptoms**: Rate limiting not working, cache misses, slow responses

**Diagnostic Steps**:

```bash
# Check Redis instance
gcloud redis instances describe simplebuildpro-redis --region=us-central1

# Check memory usage
gcloud redis instances describe simplebuildpro-redis --format="value(memorySizeGb,memorySizeGb)"
```

**Mitigation**:

- API has fallback to in-memory rate limiting — service continues degraded
- Restart Redis if unresponsive
- Scale up memory if OOM

---

### 3.5 — Billing System Failure (SEV-2)

**Symptoms**: Stripe webhooks failing, usage not tracked, charges not processing

**Diagnostic Steps**:

```bash
# Check Stripe webhook logs
# Go to: https://dashboard.stripe.com/webhooks

# Check billing-related logs
gcloud logging read "jsonPayload.message=~\"billing\" AND severity>=WARNING" --limit=50 --project=simplebuildpro

# Check Cloud Scheduler job
gcloud scheduler jobs describe daily-billing --location=us-central1
```

**Mitigation**:

- Stripe webhooks auto-retry for 72 hours
- Daily billing job can be manually triggered
- Usage logs are persisted — no data loss, just delayed billing

---

### 3.6 — Deployment Pipeline Failure (SEV-3)

**Symptoms**: Cloud Build failing, images not pushing, deploys stuck

```bash
# Check recent builds
gcloud builds list --limit=5 --project=simplebuildpro

# Get build logs
gcloud builds log BUILD_ID --project=simplebuildpro

# Manual deploy (bypass CI)
cd /path/to/simplebuildpro
gcloud builds submit --config=cloudbuild-api.yaml --project=simplebuildpro
```

---

## 4. Communication Templates

### Internal Status Update

```
INCIDENT: [Brief description]
SEVERITY: SEV-[1-4]
STATUS: [Investigating | Identified | Mitigating | Resolved]
IMPACT: [Who/what is affected]
NEXT UPDATE: [Time]
ACTIONS TAKEN: [List]
```

### Customer Communication (SEV-1/2)

```
Subject: [Service Disruption] SimpleBuild Pro — [Brief Description]

We are currently experiencing [issue description].
Our team is actively working on a resolution.

Impact: [What users may experience]
Workaround: [If any]

We will provide updates every [30 min / 1 hour].

— SimpleBuild Pro Engineering
```

---

## 5. Post-Incident Review

### Required for SEV-1 and SEV-2 incidents

**Timeline** (within 48 hours of resolution):

1. Write incident report (use template below)
2. Identify root cause
3. Define action items with owners and deadlines
4. Share with team

### Post-Incident Report Template

```markdown
# Incident Report: [Title]

**Date**: YYYY-MM-DD
**Duration**: X hours Y minutes
**Severity**: SEV-X
**Author**: [Name]

## Summary

[2-3 sentence summary of what happened]

## Timeline

- HH:MM — [Event]
- HH:MM — [Event]
- HH:MM — [Resolved]

## Root Cause

[What actually caused the incident]

## Impact

- Users affected: [count/percentage]
- Revenue impact: [if applicable]
- Data impact: [any data loss/corruption]

## Resolution

[What was done to fix it]

## Action Items

| #   | Action   | Owner  | Deadline | Status |
| --- | -------- | ------ | -------- | ------ |
| 1   | [Action] | [Name] | [Date]   | [ ]    |

## Lessons Learned

- What went well:
- What went poorly:
- Where we got lucky:
```

---

## 6. Preventive Measures

### Automated Health Checks

- `/health` — Overall health (DB + Redis + dependencies)
- `/health/ready` — Readiness probe (accepting traffic)
- `/health/live` — Liveness probe (process alive)
- Cloud Monitoring uptime checks every 60s

### Secret Rotation

- Auto-rotatable secrets: Monthly via `rotate-secrets.sh`
- External API keys: Quarterly manual rotation
- Rotation log: Audit trail in Secret Manager versions

### Dependency Scanning

- Dependabot: Weekly PRs for vulnerable dependencies
- Container scanning: Artifact Registry vulnerability scanning enabled
- `npm audit` in CI pipeline

### Backup & Recovery

- Cloud SQL: Daily automated backups, 30-day retention
- Point-in-time recovery: Enabled (binary logging)
- GCS: Object versioning enabled on critical buckets
- Recovery Time Objective (RTO): < 1 hour
- Recovery Point Objective (RPO): < 5 minutes

---

## 7. Key Infrastructure Details

| Component  | Endpoint / Resource                | Region      |
| ---------- | ---------------------------------- | ----------- |
| API        | simplebuildpro-api (Cloud Run)     | us-central1 |
| Web        | simplebuildpro-web (Cloud Run)     | us-central1 |
| Database   | simplebuildpro-db (Cloud SQL)      | us-central1 |
| Redis      | simplebuildpro-redis (Memorystore) | us-central1 |
| WAF        | simplebuildpro-waf (Cloud Armor)   | global      |
| LB         | 34.120.143.111 (HTTPS LB)          | global      |
| DNS        | simplebuildpro.com (Cloud DNS)     | global      |
| Storage    | simplebuildpro-\* (GCS)            | us-central1 |
| Secrets    | Secret Manager                     | global      |
| Monitoring | Cloud Monitoring                   | global      |

---

_This playbook is a living document. Update after every incident review._
