# SimpleBuild Pro — Penetration Testing Program

**Version**: 1.0  
**Frequency**: Annual (minimum) + after major releases  
**Scope**: Full-stack application + infrastructure

---

## 1. Scope Definition

### 1.1 In-Scope Assets

| Asset | Type | Priority |
|-------|------|----------|
| api.simplebuildpro.com | Web API (Hono/Node.js) | Critical |
| app.simplebuildpro.com | Web Application (Next.js) | Critical |
| simplebuildpro.com | Marketing site | Medium |
| *.sites.simplebuildpro.com | User-deployed sites | High |
| Cloud SQL (private IP) | Database | Critical |
| Redis (VPC) | Cache/Sessions | High |
| GCS buckets | Object storage | High |
| Cloud Run services | Container runtime | High |
| Load Balancer (34.120.143.111) | Network entry point | Critical |
| IAM & Service Accounts | Access control | Critical |

### 1.2 Out-of-Scope

- Third-party services (Stripe, Anthropic, GitHub) — test only integration points
- Physical infrastructure (managed by GCP)
- DDoS testing (requires GCP approval)
- Social engineering (separate engagement)

### 1.3 Testing Types

| Type | Frequency | Method |
|------|-----------|--------|
| OWASP Top 10 assessment | Annual | Automated + Manual |
| API security testing | Quarterly | Automated |
| Authentication/Authorization | Annual | Manual |
| Business logic testing | Annual | Manual |
| Infrastructure scanning | Monthly | Automated |
| Dependency vulnerability | Continuous | Automated (Dependabot) |
| Container scanning | On every build | Automated |

---

## 2. OWASP Top 10 (2021) Testing Checklist

### A01:2021 – Broken Access Control
- [ ] Test horizontal privilege escalation (access other user's projects)
- [ ] Test vertical privilege escalation (user → admin)
- [ ] Test IDOR on all resource endpoints (/projects/:id, /files/:id, etc.)
- [ ] Test org membership bypass (access other org's resources)
- [ ] Test plan-gated feature bypass (free → enterprise features)
- [ ] Verify CORS configuration doesn't allow arbitrary origins
- [ ] Test JWT manipulation (algorithm confusion, expired tokens)
- [ ] Test API rate limiting bypass

### A02:2021 – Cryptographic Failures
- [ ] Verify TLS 1.3 enforcement (no TLS 1.0/1.1)
- [ ] Check for sensitive data in URLs (tokens, passwords)
- [ ] Verify password hashing (bcrypt, appropriate cost factor)
- [ ] Test encryption key rotation procedures
- [ ] Check for hardcoded secrets in client-side code
- [ ] Verify SSO/SAML encryption (signed assertions)

### A03:2021 – Injection
- [ ] SQL injection on all input parameters
- [ ] NoSQL injection (if applicable)
- [ ] OS command injection (build/deploy pipeline)
- [ ] LDAP injection (SSO/OIDC integration)
- [ ] Template injection (user-deployed sites)
- [ ] Header injection (CRLF)

### A04:2021 – Insecure Design
- [ ] Test business logic flaws (billing manipulation)
- [ ] Test race conditions (concurrent operations)
- [ ] Test resource exhaustion (unbounded uploads, AI tokens)
- [ ] Verify threat modeling coverage

### A05:2021 – Security Misconfiguration
- [ ] Check security headers (CSP, HSTS, X-Frame-Options)
- [ ] Verify error messages don't leak internal details
- [ ] Check default credentials
- [ ] Verify unnecessary services/endpoints are disabled
- [ ] Test debug/admin endpoints exposure
- [ ] Check Cloud Run/GKE security configuration

### A06:2021 – Vulnerable Components
- [ ] Scan all npm dependencies for known CVEs
- [ ] Check Docker base image vulnerabilities
- [ ] Verify no end-of-life components in use
- [ ] Test for prototype pollution

### A07:2021 – Authentication Failures
- [ ] Test brute force protection
- [ ] Test credential stuffing defenses
- [ ] Test MFA bypass techniques
- [ ] Test password reset flow vulnerabilities
- [ ] Test session fixation/hijacking
- [ ] Test OAuth flow vulnerabilities (CSRF, open redirect)
- [ ] Test SSO/SAML assertion replay

### A08:2021 – Software and Data Integrity
- [ ] Verify CI/CD pipeline integrity
- [ ] Test for deserialization vulnerabilities
- [ ] Check dependency integrity (lockfile, checksums)
- [ ] Verify webhook signature validation (Stripe)

### A09:2021 – Security Logging & Monitoring
- [ ] Verify all security events are logged
- [ ] Test log injection/forging
- [ ] Verify alerting triggers on suspicious activity
- [ ] Test audit log integrity (tamper detection)

### A10:2021 – SSRF
- [ ] Test SSRF on URL input fields (deploy targets, webhooks)
- [ ] Test SSRF via file upload (SVG, XML)
- [ ] Verify internal service access restrictions
- [ ] Test metadata endpoint access (169.254.169.254)

---

## 3. Automated Security Scanning Configuration

### 3.1 OWASP ZAP Baseline Scan

```yaml
# .github/workflows/security-scan.yaml
name: Security Scan

on:
  schedule:
    - cron: '0 2 * * 1'  # Weekly Monday 2 AM UTC
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  zap-baseline:
    runs-on: ubuntu-latest
    name: OWASP ZAP Baseline Scan
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: ZAP Baseline Scan (API)
        uses: zaproxy/action-baseline@v0.12.0
        with:
          target: 'https://api.simplebuildpro.com'
          rules_file_name: '.zap/rules.tsv'
          cmd_options: '-a -j -l WARN'
          fail_action: true
          allow_issue_writing: true

      - name: ZAP API Scan
        uses: zaproxy/action-api-scan@v0.9.0
        with:
          target: 'https://api.simplebuildpro.com/openapi.json'
          format: openapi
          fail_action: true

      - name: Upload ZAP Report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: zap-report
          path: report_html.html

  nuclei-scan:
    runs-on: ubuntu-latest
    name: Nuclei Vulnerability Scan
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Run Nuclei
        uses: projectdiscovery/nuclei-action@main
        with:
          target: 'https://api.simplebuildpro.com,https://app.simplebuildpro.com'
          templates: 'cves,vulnerabilities,misconfiguration,exposed-panels'
          severity: 'critical,high,medium'
          output: nuclei-results.txt

      - name: Upload Results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: nuclei-results
          path: nuclei-results.txt

  dependency-audit:
    runs-on: ubuntu-latest
    name: Dependency Audit
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Dependencies
        run: npm ci

      - name: npm audit
        run: npm audit --audit-level=high
        continue-on-error: true

      - name: Snyk Security Scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          args: --severity-threshold=high
        continue-on-error: true
```

### 3.2 ZAP Rules Configuration

```tsv
# .zap/rules.tsv
# Rule ID	Action	Description
10010	IGNORE	Cookie No HttpOnly Flag (handled by framework)
10011	IGNORE	Cookie Without Secure Flag (all HTTPS)
10015	WARN	Incomplete or No Cache-control Header
10017	FAIL	Cross-Domain JavaScript Source File Inclusion
10020	FAIL	X-Frame-Options Header
10021	WARN	X-Content-Type-Options Header
10038	FAIL	Content Security Policy Header
10098	WARN	Cross-Domain Misconfiguration
40012	FAIL	Cross Site Scripting (Reflected)
40014	FAIL	Cross Site Scripting (Persistent)
40018	FAIL	SQL Injection
90001	FAIL	Insecure JSF ViewState
90034	FAIL	Cloud Metadata Potentially Exposed
```

### 3.3 Infrastructure Scanning (GCP)

```bash
#!/bin/bash
# infra/scripts/security-scan.sh
# Automated infrastructure security assessment

set -euo pipefail

PROJECT_ID="simplebuildpro"
OUTPUT_DIR="security-reports/$(date +%Y-%m-%d)"
mkdir -p "$OUTPUT_DIR"

echo "=== SimpleBuild Pro Security Scan — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# 1. Check public-facing services
echo "[1/6] Scanning public-facing services..."
gcloud run services list --project="$PROJECT_ID" --format=json | \
  jq '[.[] | {name: .metadata.name, ingress: .metadata.annotations["run.googleapis.com/ingress"]}]' \
  > "$OUTPUT_DIR/public-services.json"

# 2. Check IAM policy for overly-permissive roles
echo "[2/6] Auditing IAM policies..."
gcloud projects get-iam-policy "$PROJECT_ID" --format=json | \
  jq '[.bindings[] | select(.role | test("roles/(owner|editor|admin)"))]' \
  > "$OUTPUT_DIR/privileged-roles.json"

# 3. Check for public GCS buckets
echo "[3/6] Checking GCS bucket permissions..."
for bucket in $(gsutil ls -p "$PROJECT_ID" 2>/dev/null); do
  acl=$(gsutil iam get "$bucket" 2>/dev/null | jq -r '.bindings[] | select(.members[] | test("allUsers|allAuthenticatedUsers")) | .role' 2>/dev/null || echo "")
  if [ -n "$acl" ]; then
    echo "WARNING: $bucket has public access: $acl"
  fi
done > "$OUTPUT_DIR/bucket-access.txt"

# 4. Check Cloud SQL settings
echo "[4/6] Auditing Cloud SQL configuration..."
gcloud sql instances describe simplebuildpro-db --project="$PROJECT_ID" --format=json | \
  jq '{
    publicIp: .ipAddresses[] | select(.type=="PRIMARY") | .ipAddress,
    requireSsl: .settings.ipConfiguration.requireSsl,
    authorizedNetworks: .settings.ipConfiguration.authorizedNetworks,
    backupEnabled: .settings.backupConfiguration.enabled,
    databaseFlags: .settings.databaseFlags
  }' > "$OUTPUT_DIR/cloudsql-security.json" 2>/dev/null

# 5. Check for exposed secrets
echo "[5/6] Checking secret access..."
gcloud secrets list --project="$PROJECT_ID" --format="json" | \
  jq '[.[] | {name: .name, replication: .replication}]' \
  > "$OUTPUT_DIR/secrets-inventory.json"

# 6. SSL/TLS configuration check
echo "[6/6] Checking SSL/TLS configuration..."
echo | openssl s_client -connect api.simplebuildpro.com:443 -servername api.simplebuildpro.com 2>/dev/null | \
  openssl x509 -noout -dates -subject -issuer > "$OUTPUT_DIR/ssl-cert-info.txt" 2>/dev/null || echo "SSL check skipped"

echo ""
echo "=== Scan Complete ==="
echo "Results: $OUTPUT_DIR/"
ls -la "$OUTPUT_DIR/"
```

---

## 4. Vulnerability Management Process

### 4.1 Severity Classification

| CVSS Score | Severity | SLA to Remediate | Notification |
|-----------|----------|-----------------|--------------|
| 9.0–10.0 | Critical | 24 hours | Immediate (PagerDuty) |
| 7.0–8.9 | High | 7 days | Same day (Slack) |
| 4.0–6.9 | Medium | 30 days | Weekly digest |
| 0.1–3.9 | Low | 90 days | Monthly report |
| 0.0 | Info | Best effort | Quarterly review |

### 4.2 Remediation Workflow

```
Discovery → Triage → Assign → Fix → Verify → Close
    ↓          ↓        ↓       ↓       ↓        ↓
  Scan/    Severity  Developer  PR +   Rescan   Document
  Report   Rating    assigned   Review  passes   in log
```

### 4.3 Exception Process

If a vulnerability cannot be fixed within SLA:
1. Document risk assessment
2. Identify compensating controls
3. Get approval from security lead
4. Set review date (max 90 days)
5. Track in exception register

---

## 5. Reporting

### 5.1 Report Template

```markdown
# Penetration Test Report — [Date]

## Executive Summary
- **Tester**: [Name/Firm]
- **Date Range**: [Start] — [End]
- **Scope**: [Assets tested]
- **Methodology**: OWASP Testing Guide v4.2

## Findings Summary
| Severity | Count | Fixed | Open |
|----------|-------|-------|------|
| Critical | X | X | 0 |
| High | X | X | X |
| Medium | X | X | X |
| Low | X | X | X |

## Detailed Findings
### [FINDING-001] [Title]
- **Severity**: Critical/High/Medium/Low
- **CVSS**: X.X
- **Location**: [URL/endpoint]
- **Description**: [Details]
- **Impact**: [Business impact]
- **Proof of Concept**: [Steps to reproduce]
- **Remediation**: [Fix recommendation]
- **Status**: Fixed/Open/Accepted Risk

## Recommendations
[Priority-ordered list of improvements]
```

---

## 6. Annual Testing Schedule

| Month | Activity |
|-------|----------|
| January | Dependency audit + container scan review |
| February | Internal pentest (automated) |
| March | External pentest engagement (annual) |
| April | Remediation sprint |
| May | Infrastructure security review |
| June | Compliance evidence collection (SOC 2) |
| July | Red team exercise (if applicable) |
| August | API security focused testing |
| September | DR/BCP testing |
| October | Pre-audit security assessment |
| November | SOC 2 Type II observation |
| December | Year-end security review + planning |
