# SimpleBuild Pro — SOC 2 Type II Preparation

**Target Audit Date**: Q4 2026  
**Audit Firm**: TBD (recommend: Vanta-assisted with Schellman/Prescient Assurance)  
**Scope**: SimpleBuild Pro SaaS platform (API, Web, infrastructure)

---

## 1. SOC 2 Trust Service Criteria (TSC) Mapping

### 1.1 Security (Common Criteria — Required)

| Control ID | Control | Evidence | Status |
|-----------|---------|----------|--------|
| CC1.1 | COSO Principle 1: Integrity & Ethics | Code of conduct, acceptable use policy | 🟡 Planned |
| CC2.1 | Board/Management oversight | Org chart, security responsibilities doc | 🟡 Planned |
| CC3.1 | Risk assessment process | Risk register, annual risk assessment | 🟡 Planned |
| CC4.1 | Monitoring controls | Cloud Monitoring alerts, uptime checks | ✅ Done |
| CC5.1 | Control activities | Automated CI/CD gates, code review policy | ✅ Done |
| CC6.1 | Logical access controls | IAM policies, MFA, SSO/SAML | ✅ Done |
| CC6.2 | Access provisioning | Role-based access, org membership | ✅ Done |
| CC6.3 | Access removal | Deprovisioning scripts, offboarding checklist | 🟡 Planned |
| CC6.6 | System boundaries | VPC isolation, firewall rules, private IPs | ✅ Done |
| CC6.7 | Encryption in transit | TLS 1.3, HSTS, secure headers | ✅ Done |
| CC6.8 | Encryption at rest | Cloud SQL encryption, GCS encryption | ✅ Done |
| CC7.1 | Vulnerability management | Dependabot, container scanning | ✅ Done |
| CC7.2 | Incident detection | Cloud Monitoring, alerting, audit logs | ✅ Done |
| CC7.3 | Incident response | Incident response playbook | ✅ Done |
| CC7.4 | Incident recovery | Backup/restore procedures, PITR | ✅ Done |
| CC8.1 | Change management | Git history, PR reviews, CI/CD pipeline | ✅ Done |
| CC9.1 | Risk mitigation | Rate limiting, WAF, DDoS protection | ✅ Done |

### 1.2 Availability

| Control | Evidence | Status |
|---------|----------|--------|
| Uptime monitoring | Cloud Monitoring uptime checks (5min intervals) | ✅ Done |
| Capacity planning | Auto-scaling (1–10 instances), resource monitoring | ✅ Done |
| Backup & recovery | Daily backups, PITR, 7-day retention | ✅ Done |
| Disaster recovery plan | Multi-region failover documentation | 🟡 Planned |
| SLA documentation | SLA_POLICY.md with tiered commitments | ✅ Done |

### 1.3 Confidentiality

| Control | Evidence | Status |
|---------|----------|--------|
| Data classification | Policy document (public/internal/confidential/restricted) | 🟡 Planned |
| Access restrictions | IAM least-privilege, VPC isolation | ✅ Done |
| Data retention | GDPR data retention policies | ✅ Done |
| Secure disposal | Account deletion (GDPR Art. 17) | ✅ Done |
| NDA/Contracts | Customer data processing agreements | 🟡 Planned |

### 1.4 Processing Integrity

| Control | Evidence | Status |
|---------|----------|--------|
| Input validation | Hono validators, Zod schemas | ✅ Done |
| Error handling | Centralized error handler, structured logging | ✅ Done |
| Data integrity checks | DB constraints, foreign keys, indexes | ✅ Done |
| Audit trail | Comprehensive audit logging (40+ event types) | ✅ Done |

### 1.5 Privacy

| Control | Evidence | Status |
|---------|----------|--------|
| Privacy notice | Privacy policy documentation | 🟡 Planned |
| Consent management | Cookie consent, data processing consent | 🟡 Planned |
| Data subject rights | GDPR routes (export, delete, access) | ✅ Done |
| Data minimization | Only collect necessary data | ✅ Done |
| Third-party data sharing | DPA with sub-processors | 🟡 Planned |

---

## 2. Evidence Collection Automation

### 2.1 Automated Evidence Scripts

```bash
#!/bin/bash
# infra/scripts/soc2-evidence-collector.sh
# Collects SOC 2 audit evidence from GCP infrastructure

set -euo pipefail

PROJECT_ID="simplebuildpro"
OUTPUT_DIR="evidence/$(date +%Y-%m)"
mkdir -p "$OUTPUT_DIR"

echo "=== SOC 2 Evidence Collection — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# CC6.1 — Logical Access Controls
echo "[CC6.1] Collecting IAM policies..."
gcloud projects get-iam-policy "$PROJECT_ID" --format=json > "$OUTPUT_DIR/iam-policy.json"
gcloud iam service-accounts list --project="$PROJECT_ID" --format=json > "$OUTPUT_DIR/service-accounts.json"

# CC6.6 — Network Boundaries
echo "[CC6.6] Collecting VPC/firewall rules..."
gcloud compute firewall-rules list --project="$PROJECT_ID" --format=json > "$OUTPUT_DIR/firewall-rules.json"
gcloud compute networks list --project="$PROJECT_ID" --format=json > "$OUTPUT_DIR/vpc-networks.json"
gcloud sql instances describe simplebuildpro-db --project="$PROJECT_ID" --format=json > "$OUTPUT_DIR/cloudsql-config.json"

# CC6.7/6.8 — Encryption
echo "[CC6.7/6.8] Collecting encryption configuration..."
gcloud sql instances describe simplebuildpro-db --format="value(settings.ipConfiguration,settings.dataDiskType)" > "$OUTPUT_DIR/db-encryption.txt"

# CC7.1 — Vulnerability Management
echo "[CC7.1] Collecting vulnerability scan results..."
gcloud artifacts docker images list-vulnerabilities \
  "us-central1-docker.pkg.dev/$PROJECT_ID/simplebuildpro/api:phase1" \
  --format=json > "$OUTPUT_DIR/container-vulnerabilities.json" 2>/dev/null || echo "No scan results"

# CC4.1 — Monitoring
echo "[CC4.1] Collecting monitoring configuration..."
gcloud monitoring uptime list-configs --project="$PROJECT_ID" --format=json > "$OUTPUT_DIR/uptime-checks.json"
gcloud monitoring alert-policies list --project="$PROJECT_ID" --format=json > "$OUTPUT_DIR/alert-policies.json"

# CC8.1 — Change Management
echo "[CC8.1] Collecting recent deployments..."
gcloud run revisions list --service=simplebuildpro-api --region=us-central1 \
  --project="$PROJECT_ID" --format=json --limit=50 > "$OUTPUT_DIR/api-revisions.json"
gcloud builds list --project="$PROJECT_ID" --format=json --limit=50 > "$OUTPUT_DIR/cloud-builds.json"

# CC7.4 — Backup Status
echo "[CC7.4] Collecting backup configuration..."
gcloud sql backups list --instance=simplebuildpro-db --project="$PROJECT_ID" \
  --format=json --limit=30 > "$OUTPUT_DIR/db-backups.json"

# Availability — Uptime metrics
echo "[Availability] Collecting uptime metrics..."
gcloud monitoring time-series list \
  --project="$PROJECT_ID" \
  --filter='metric.type="monitoring.googleapis.com/uptime_check/check_passed"' \
  --interval="$(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%SZ)/$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --format=json > "$OUTPUT_DIR/uptime-metrics.json" 2>/dev/null || echo "Metrics API not available"

echo ""
echo "=== Evidence collection complete ==="
echo "Output directory: $OUTPUT_DIR"
echo "Files collected: $(find "$OUTPUT_DIR" -type f | wc -l)"
ls -la "$OUTPUT_DIR"
```

### 2.2 Continuous Compliance Monitoring

| Check | Frequency | Tool | Alert |
|-------|-----------|------|-------|
| IAM policy drift | Daily | gcloud + diff | Slack |
| Firewall rule changes | Real-time | Cloud Audit Logs | PagerDuty |
| Secret rotation status | Weekly | rotate-secrets.sh | Email |
| SSL certificate expiry | Daily | cert-monitor | Slack |
| Container vulnerabilities | On push | Artifact Registry | Block deploy |
| Dependency updates | Weekly | Dependabot | GitHub PR |
| Access review | Monthly | IAM audit script | Report |
| Backup verification | Weekly | Restore test | Email |

---

## 3. Policies Required (Documentation)

### 3.1 Must-Have Policies

| Policy | Status | Owner |
|--------|--------|-------|
| Information Security Policy | 🟡 Draft needed | CTO |
| Acceptable Use Policy | 🟡 Draft needed | HR/Legal |
| Access Control Policy | ✅ Implemented (IAM + SSO) | Engineering |
| Change Management Policy | ✅ Implemented (CI/CD + PR reviews) | Engineering |
| Incident Response Policy | ✅ Done (INCIDENT_RESPONSE.md) | Engineering |
| Data Classification Policy | 🟡 Draft needed | Security |
| Data Retention & Disposal Policy | ✅ Implemented (GDPR routes) | Engineering |
| Business Continuity Plan | 🟡 Draft needed | Operations |
| Vendor Management Policy | 🟡 Draft needed | Procurement |
| Employee Security Training | 🟡 Plan needed | HR |
| Physical Security Policy | N/A (cloud-native) | — |
| Encryption Policy | ✅ Implemented (TLS 1.3 + AES-256) | Engineering |
| Vulnerability Management Policy | ✅ Implemented (Dependabot + scanning) | Engineering |
| Risk Assessment Methodology | 🟡 Draft needed | Security |

### 3.2 Policy Template

```markdown
# [Policy Name]

## Purpose
[Why this policy exists]

## Scope
[Who/what it applies to]

## Policy Statement
[The actual requirements]

## Roles & Responsibilities
[Who does what]

## Compliance
[How compliance is measured and enforced]

## Exceptions
[Process for requesting exceptions]

## Review Schedule
[How often this policy is reviewed — minimum annually]

## Version History
| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | YYYY-MM-DD | Name | Initial version |
```

---

## 4. Gap Analysis & Remediation Timeline

### 4.1 Current Gaps

| Gap | Priority | Effort | Target Date |
|-----|----------|--------|-------------|
| Formal security policies (6 docs) | High | 2 weeks | June 2026 |
| Employee security training program | Medium | 1 week | July 2026 |
| Disaster recovery plan + testing | High | 2 weeks | June 2026 |
| Vendor risk assessments | Medium | 1 week | July 2026 |
| Data classification scheme | Medium | 3 days | June 2026 |
| Formal risk register | High | 1 week | June 2026 |
| Privacy policy (public) | High | 3 days | June 2026 |
| Board/Management oversight docs | Low | 1 week | August 2026 |

### 4.2 Readiness Score

**Current**: ~68% ready (technical controls strong, documentation gaps)  
**Target**: 95%+ by September 2026  
**Audit engagement**: October 2026  
**Report expected**: December 2026

---

## 5. Recommended Tooling

| Category | Tool | Purpose |
|----------|------|---------|
| Compliance Platform | Vanta / Drata | Automated evidence, policy management |
| Vulnerability Scanning | Artifact Registry + Trivy | Container + dependency scanning |
| Secret Management | GCP Secret Manager | Centralized secret storage + rotation |
| Access Reviews | Custom script + Vanta | Quarterly access reviews |
| Penetration Testing | External firm (annually) | Validate security controls |
| Log Aggregation | Cloud Logging + BigQuery | Long-term audit log retention |

---

## 6. Audit Preparation Checklist

### 6 Months Before Audit
- [ ] Engage audit firm (SOC 2 readiness assessment)
- [ ] Complete all policy documentation
- [ ] Implement continuous compliance monitoring
- [ ] Conduct internal controls testing
- [ ] Train team on audit process

### 3 Months Before Audit
- [ ] Readiness assessment with auditor
- [ ] Fix identified gaps
- [ ] Ensure 3+ months of evidence collection
- [ ] Conduct tabletop incident response exercise
- [ ] Complete penetration test

### 1 Month Before Audit
- [ ] Verify all evidence is collected and organized
- [ ] Pre-populate auditor's evidence request list
- [ ] Assign evidence owners for each control
- [ ] Brief team on audit interviews
- [ ] Confirm audit schedule and logistics

### During Audit (Type II — observation period: 6–12 months)
- [ ] Respond to evidence requests within 48h
- [ ] Make designated contacts available for interviews
- [ ] Continue normal operations (auditor observes)
- [ ] Document any exceptions or deviations
- [ ] Address any findings immediately
