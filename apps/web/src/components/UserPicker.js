'use client';

import { useEffect, useRef, useState } from 'react';
import { apiJson } from '../lib/api-client';

/**
 * Debounced username search + pick, backed by GET /users/lookup
 * (Sprint 6 — any authenticated user may search any ACTIVE username,
 * deliberately not restricted to case members, since sharing/approval
 * both need to reach people outside a case's normal membership list).
 *
 * @param {{value: {id: string, username: string}|null, onChange: (user: object|null) => void,
 *   excludeUserId?: string, placeholder?: string}} props
 */
export default function UserPicker({ value, onChange, excludeUserId, placeholder = 'Search a username…' }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return undefined;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const users = await apiJson(`/users/lookup?q=${encodeURIComponent(query.trim())}`);
        setResults(users.filter((u) => u.id !== excludeUserId));
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query, excludeUserId]);

  if (value) {
    return (
      <div className="row" style={{ gap: 8 }}>
        <span className="badge badge-info">{value.username}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            onChange(null);
            setQuery('');
          }}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
      />
      {open && results.length > 0 && (
        <div
          className="card"
          style={{
            position: 'absolute',
            zIndex: 10,
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            padding: 4,
            maxHeight: 200,
            overflowY: 'auto',
          }}
        >
          {results.map((u) => (
            <button
              key={u.id}
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ display: 'block', width: '100%', textAlign: 'left' }}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(u);
                setQuery('');
                setOpen(false);
              }}
            >
              {u.username}
              {u.full_name ? <span className="muted"> — {u.full_name}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
