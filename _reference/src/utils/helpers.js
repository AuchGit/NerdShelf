/**
 * Formats a date string to a human-readable form.
 * @param {string | Date} date
 * @param {{ includeTime?: boolean }} options
 */
export function formatDate(date, { includeTime = false } = {}) {
  const d = new Date(date);
  const opts = { year: 'numeric', month: 'short', day: 'numeric' };
  if (includeTime) {
    opts.hour = '2-digit';
    opts.minute = '2-digit';
  }
  return d.toLocaleDateString('en-US', opts);
}

/**
 * Returns initials from a name or email string.
 * @param {string} value
 */
export function getInitials(value = '') {
  if (!value) return '?';
  const parts = value.trim().split(/[\s@.]+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Truncates a string to a maximum length.
 * @param {string} str
 * @param {number} max
 */
export function truncate(str = '', max = 60) {
  if (str.length <= max) return str;
  return str.slice(0, max).trimEnd() + '…';
}

/**
 * Delays execution by ms milliseconds.
 * @param {number} ms
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Classnames helper — filters falsy values and joins.
 * @param {...(string | boolean | null | undefined)} classes
 */
export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

/**
 * Generates a random avatar gradient from an id/email string.
 * Returns a Tailwind gradient class pair.
 * @param {string} seed
 */
export function avatarGradient(seed = '') {
  const gradients = [
    ['from-blue-500',   'to-indigo-600'],
    ['from-purple-500', 'to-pink-600'],
    ['from-emerald-500','to-teal-600'],
    ['from-orange-500', 'to-red-600'],
    ['from-yellow-500', 'to-amber-600'],
    ['from-cyan-500',   'to-blue-600'],
    ['from-rose-500',   'to-pink-600'],
    ['from-violet-500', 'to-purple-600'],
  ];
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) & 0xffff;
  return gradients[hash % gradients.length];
}
