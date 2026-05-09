# SimpleBuild Pro — Service Level Agreement (SLA)

**Version**: 1.0  
**Effective Date**: 2026-05-09  
**Last Updated**: 2026-05-09

---

## 1. Service Availability

### 1.1 Uptime Commitment

| Tier | Monthly Uptime SLA | Max Downtime/Month | Credits |
|------|-------------------|-------------------|---------|
| Free | Best effort | N/A | None |
| Pro | 99.5% | ~3.6 hours | 10% |
| Business | 99.9% | ~43 minutes | 25% |
| Enterprise (Shared) | 99.95% | ~22 minutes | 50% |
| Enterprise (Dedicated) | 99.99% | ~4.3 minutes | 100% |

### 1.2 Uptime Calculation

```
Monthly Uptime % = ((Total Minutes - Downtime Minutes) / Total Minutes) × 100
```

**Excluded from downtime:**
- Scheduled maintenance (announced ≥72h in advance)
- Force majeure events
- Customer-caused issues (misconfiguration, abuse)
- Third-party service failures (GCP regional outages)

---

## 2. Service Credits

### 2.1 Credit Calculation

| Monthly Uptime | Credit (% of monthly bill) |
|---------------|---------------------------|
| 99.0% – SLA target | 10% |
| 95.0% – 99.0% | 25% |
| 90.0% – 95.0% | 50% |
| < 90.0% | 100% |

### 2.2 Credit Request Process

1. Customer submits credit request within 30 days of incident
2. Request must include: dates, times, affected services, impact description
3. SimpleBuild Pro validates against internal monitoring data
4. Credits applied to next billing cycle (non-transferable, non-refundable)

---

## 3. Performance SLAs

### 3.1 API Response Times (p95)

| Endpoint Category | Target | Maximum |
|-------------------|--------|---------|
| Authentication | 200ms | 500ms |
| Project CRUD | 300ms | 1000ms |
| File Operations | 500ms | 2000ms |
| AI Generation | 10s | 30s |
| Build/Deploy | 60s | 300s |
| Health Check | 50ms | 200ms |

### 3.2 Build & Deploy Performance

| Metric | Standard | Enterprise |
|--------|----------|------------|
| Build Queue Time | < 30s | < 5s |
| Build Duration (avg) | < 120s | < 60s |
| Deploy Propagation | < 60s | < 30s |
| Rollback Time | < 30s | < 10s |

---

## 4. Support Response Times

### 4.1 Severity Definitions

| Severity | Definition | Example |
|----------|-----------|---------|
| SEV-1 (Critical) | Complete service outage | API unreachable, data loss |
| SEV-2 (High) | Major feature unavailable | Builds failing, deploys blocked |
| SEV-3 (Medium) | Partial degradation | Slow responses, intermittent errors |
| SEV-4 (Low) | Minor issue | UI glitch, documentation error |

### 4.2 Response Time Commitments

| Severity | Free | Pro | Business | Enterprise |
|----------|------|-----|----------|------------|
| SEV-1 | 24h | 4h | 1h | 15min |
| SEV-2 | 48h | 8h | 4h | 1h |
| SEV-3 | 5d | 24h | 8h | 4h |
| SEV-4 | Best effort | 48h | 24h | 8h |

### 4.3 Support Channels

| Tier | Channels |
|------|----------|
| Free | Community forum, documentation |
| Pro | Email support (business hours) |
| Business | Email + chat (extended hours), phone (SEV-1/2) |
| Enterprise | 24/7 dedicated support, Slack channel, named TAM |

---

## 5. Data Protection SLA

### 5.1 Backup & Recovery

| Metric | Commitment |
|--------|-----------|
| Backup Frequency | Every 6 hours (Enterprise: continuous) |
| Backup Retention | 30 days (Enterprise: 90 days) |
| RPO (Recovery Point Objective) | 6 hours (Enterprise: 1 hour) |
| RTO (Recovery Time Objective) | 4 hours (Enterprise: 1 hour) |
| Backup Encryption | AES-256 at rest |
| Cross-region Replication | Enterprise only |

### 5.2 Data Durability

- **Object Storage (GCS)**: 99.999999999% (11 nines) durability
- **Database (Cloud SQL)**: 99.95% availability, PITR enabled
- **Redis Cache**: Non-durable (cache-only, reconstructable)

---

## 6. Security SLA

### 6.1 Vulnerability Response

| Severity | Detection → Patch | Notification |
|----------|-------------------|-------------|
| Critical (CVSS ≥ 9.0) | 24 hours | Immediate |
| High (CVSS 7.0–8.9) | 72 hours | 24 hours |
| Medium (CVSS 4.0–6.9) | 7 days | Weekly digest |
| Low (CVSS < 4.0) | 30 days | Monthly report |

### 6.2 Security Commitments

- Annual penetration testing (results shared with Enterprise customers)
- SOC 2 Type II audit (annual)
- Encryption in transit (TLS 1.3) and at rest (AES-256)
- Multi-factor authentication available for all tiers
- SSO/SAML available for Business and Enterprise

---

## 7. Maintenance Windows

### 7.1 Scheduled Maintenance

- **Window**: Tuesdays and Thursdays, 02:00–06:00 UTC
- **Notice**: ≥72 hours advance notification
- **Frequency**: ≤ 2 per month (Enterprise: ≤ 1 per month)
- **Duration**: ≤ 2 hours per window

### 7.2 Emergency Maintenance

- May occur without advance notice for critical security patches
- Notification sent within 15 minutes of start
- Post-maintenance report within 24 hours

---

## 8. Compliance & Certifications

### 8.1 Current

- GDPR compliant (EU data subjects)
- TLS 1.3 encryption
- Cloud SQL encryption at rest
- VPC network isolation
- IAM least-privilege access

### 8.2 In Progress (Target: Q4 2026)

- SOC 2 Type II certification
- ISO 27001 preparation
- HIPAA BAA availability (Enterprise)
- PCI DSS Level 1 (for payment processing)

---

## 9. Escalation Path

```
Level 1: Support Engineer (initial response)
    ↓ (no resolution within SLA)
Level 2: Senior Engineer / Team Lead
    ↓ (SEV-1/2 unresolved > 2h)
Level 3: Engineering Manager
    ↓ (SEV-1 unresolved > 4h)
Level 4: VP Engineering / CTO
    ↓ (SEV-1 unresolved > 8h)
Level 5: CEO (customer communication)
```

---

## 10. SLA Exclusions

This SLA does not apply to:
1. Alpha/Beta features clearly marked as such
2. Free tier accounts
3. Abuse of the platform (DDoS, cryptomining, etc.)
4. Customer network issues
5. Force majeure (natural disasters, war, pandemic)
6. Third-party integrations not managed by SimpleBuild Pro

---

## Appendix A: Monitoring & Reporting

- **Status Page**: status.simplebuildpro.com (planned)
- **Uptime Reports**: Monthly for Business/Enterprise (automated)
- **Incident Reports**: Published within 48h of SEV-1/2 resolution
- **Quarterly Business Reviews**: Enterprise customers only
