// ============================================================
// SimpleBuild Pro — Validation Rules
// Shared between frontend and backend — single source of truth
// ============================================================

export const VALIDATION = {
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    maxLength: 255,
    message: 'Please enter a valid email address.',
  },
  password: {
    minLength: 8,
    maxLength: 128,
    pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/,
    message: 'Password must be at least 8 characters with uppercase, lowercase, and a number.',
  },
  name: {
    minLength: 1,
    maxLength: 100,
    pattern: /^[a-zA-Z0-9\s\-'.]+$/,
    message: 'Name can only contain letters, numbers, spaces, hyphens, apostrophes, and periods.',
  },
  projectName: {
    minLength: 1,
    maxLength: 64,
    pattern: /^[a-zA-Z0-9\s\-_]+$/,
    message: 'Project name can only contain letters, numbers, spaces, hyphens, and underscores.',
  },
  projectSlug: {
    minLength: 1,
    maxLength: 64,
    pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    message: 'Slug must be lowercase alphanumeric with hyphens only.',
  },
  filePath: {
    maxLength: 512,
    pattern: /^[a-zA-Z0-9._\-/]+$/,
    forbiddenPaths: ['../', '~/', '/etc/', '/usr/', '/var/', '/root/'],
    message: 'Invalid file path.',
  },
  domain: {
    pattern: /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
    maxLength: 253,
    message: 'Please enter a valid domain name.',
  },
  orgSlug: {
    minLength: 2,
    maxLength: 48,
    pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    message: 'Organization slug must be lowercase alphanumeric with hyphens.',
  },
} as const;

export function validateEmail(email: string): { valid: boolean; error?: string } {
  if (!email || email.length > VALIDATION.email.maxLength) {
    return { valid: false, error: VALIDATION.email.message };
  }
  if (!VALIDATION.email.pattern.test(email)) {
    return { valid: false, error: VALIDATION.email.message };
  }
  return { valid: true };
}

export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (!password || password.length < VALIDATION.password.minLength) {
    return { valid: false, error: `Password must be at least ${VALIDATION.password.minLength} characters.` };
  }
  if (password.length > VALIDATION.password.maxLength) {
    return { valid: false, error: `Password must be at most ${VALIDATION.password.maxLength} characters.` };
  }
  if (!VALIDATION.password.pattern.test(password)) {
    return { valid: false, error: VALIDATION.password.message };
  }
  return { valid: true };
}

export function validateProjectName(name: string): { valid: boolean; error?: string } {
  if (!name || name.length < VALIDATION.projectName.minLength) {
    return { valid: false, error: 'Project name is required.' };
  }
  if (name.length > VALIDATION.projectName.maxLength) {
    return { valid: false, error: `Project name must be at most ${VALIDATION.projectName.maxLength} characters.` };
  }
  if (!VALIDATION.projectName.pattern.test(name)) {
    return { valid: false, error: VALIDATION.projectName.message };
  }
  return { valid: true };
}

export function validateFilePath(path: string): { valid: boolean; error?: string } {
  if (!path || path.length > VALIDATION.filePath.maxLength) {
    return { valid: false, error: 'Invalid file path.' };
  }
  if (!VALIDATION.filePath.pattern.test(path)) {
    return { valid: false, error: 'File path contains invalid characters.' };
  }
  for (const forbidden of VALIDATION.filePath.forbiddenPaths) {
    if (path.includes(forbidden)) {
      return { valid: false, error: 'File path contains forbidden path segments.' };
    }
  }
  return { valid: true };
}

export function validateDomain(domain: string): { valid: boolean; error?: string } {
  if (!domain || domain.length > VALIDATION.domain.maxLength) {
    return { valid: false, error: VALIDATION.domain.message };
  }
  if (!VALIDATION.domain.pattern.test(domain)) {
    return { valid: false, error: VALIDATION.domain.message };
  }
  return { valid: true };
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 64);
}
