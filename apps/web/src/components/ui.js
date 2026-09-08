'use client';

/**
 * Small, dependency-free presentational primitives shared across every
 * page — deliberately plain (no component library), styled entirely via
 * the class names defined in app/globals.css.
 */

const CASE_STATUS_TONE = {
  OPEN: 'primary',
  UNDER_INVESTIGATION: 'accent',
  UNDER_REVIEW: 'warning',
  SUBMITTED: 'info',
  CLOSED: 'neutral',
  ARCHIVED: 'neutral',
};

const DOCUMENT_STATUS_TONE = {
  DRAFT: 'neutral',
  ACTIVE: 'primary',
  UNDER_REVIEW: 'warning',
  APPROVED: 'info',
  SIGNED: 'accent',
  FINAL: 'success',
  ARCHIVED: 'neutral',
  DELETED: 'danger',
};

const INTEGRITY_TONE = {
  VERIFIED: 'success',
  MODIFIED: 'danger',
  UNKNOWN: 'neutral',
};

const USER_STATUS_TONE = {
  ACTIVE: 'success',
  INVITED: 'info',
  INACTIVE: 'neutral',
  LOCKED: 'danger',
};

const PRIORITY_TONE = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warning',
  CRITICAL: 'danger',
};

const EVIDENCE_STATUS_TONE = {
  REGISTERED: 'neutral',
  SEALED: 'info',
  VERIFIED: 'success',
  IN_CUSTODY: 'primary',
  IN_TRANSIT: 'warning',
  RECEIVED: 'accent',
  UNDER_ANALYSIS: 'warning',
  RETURNED: 'info',
  ARCHIVED: 'neutral',
};

const CUSTODY_STATUS_TONE = {
  PENDING: 'warning',
  ACKNOWLEDGED: 'info',
  COMPLETED: 'success',
  REJECTED: 'danger',
};

const SIGNATURE_STATUS_TONE = {
  PENDING: 'warning',
  SIGNED: 'success',
  DECLINED: 'danger',
};

const VERIFICATION_RESULT_TONE = {
  AUTHENTIC: 'success',
  TAMPERED: 'danger',
  SUPERSEDED: 'warning',
  UNSIGNED: 'neutral',
  NOT_FOUND: 'neutral',
};

/** @param {{tone?: string, children: import('react').ReactNode}} props */
export function Badge({ tone = 'neutral', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function CaseStatusBadge({ status }) {
  return <Badge tone={CASE_STATUS_TONE[status] || 'neutral'}>{status}</Badge>;
}

export function DocumentStatusBadge({ status }) {
  return <Badge tone={DOCUMENT_STATUS_TONE[status] || 'neutral'}>{status}</Badge>;
}

export function IntegrityBadge({ status }) {
  return <Badge tone={INTEGRITY_TONE[status] || 'neutral'}>{status || 'UNKNOWN'}</Badge>;
}

export function UserStatusBadge({ status }) {
  return <Badge tone={USER_STATUS_TONE[status] || 'neutral'}>{status}</Badge>;
}

export function PriorityBadge({ priority }) {
  return <Badge tone={PRIORITY_TONE[priority] || 'neutral'}>{priority}</Badge>;
}

export function RoleBadge({ role }) {
  return <Badge tone="pink">{role}</Badge>;
}

export function EvidenceStatusBadge({ status }) {
  return <Badge tone={EVIDENCE_STATUS_TONE[status] || 'neutral'}>{status}</Badge>;
}

export function CustodyStatusBadge({ status }) {
  return <Badge tone={CUSTODY_STATUS_TONE[status] || 'neutral'}>{status}</Badge>;
}

export function SignatureStatusBadge({ status }) {
  return <Badge tone={SIGNATURE_STATUS_TONE[status] || 'neutral'}>{status}</Badge>;
}

export function VerificationResultBadge({ status }) {
  return <Badge tone={VERIFICATION_RESULT_TONE[status] || 'neutral'}>{status}</Badge>;
}

/** @param {{tone?: 'danger'|'success'|'info', children: import('react').ReactNode}} props */
export function Alert({ tone = 'danger', children }) {
  if (!children) return null;
  return <div className={`alert alert-${tone}`}>{children}</div>;
}

export function EmptyState({ children }) {
  return <div className="empty-state">{children}</div>;
}

export function Button({ variant = 'primary', size, className, ...props }) {
  const classes = ['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : '', className || '']
    .filter(Boolean)
    .join(' ');
  // eslint-disable-next-line react/button-has-type
  return <button className={classes} {...props} />;
}

export function Field({ label, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <div className="subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}
