import { colorForUser } from '../../lib/awarenessColor';

function initialsOf(name) {
  const parts = String(name || '')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

/**
 * A person's avatar: their Google profile picture when we have one, otherwise
 * their initials on a colour derived from their identity — so the same person
 * is always the same colour, and a room full of people is still legible
 * without anyone having uploaded anything.
 */
export function Avatar({ user, size = 28, className = '', title }) {
  const name = user?.name || 'Unknown';
  const label = title ?? name;
  const style = { width: size, height: size };

  if (user?.picture) {
    return (
      <img
        className={`avatar ${className}`}
        src={user.picture}
        alt={name}
        title={label}
        style={style}
        // Google's CDN 403s the request when a referrer is sent from an
        // origin that isn't the one that issued the token.
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <span
      className={`avatar avatar-initials ${className}`}
      title={label}
      aria-label={name}
      role="img"
      style={{ ...style, background: colorForUser(user?.id || name), fontSize: Math.round(size * 0.38) }}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Overlapping row of avatars, as used for room membership. */
export function AvatarStack({ people, max = 3, size = 26 }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="avatar-stack">
      {shown.map((p, i) => (
        <Avatar key={p.id || p.clientID || i} user={p} size={size} />
      ))}
      {extra > 0 && (
        <span className="avatar avatar-initials avatar-more" style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}>
          +{extra}
        </span>
      )}
    </span>
  );
}
