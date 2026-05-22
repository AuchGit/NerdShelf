import { cn, getInitials, avatarGradient } from '@/utils/helpers';

const SIZES = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-11 h-11 text-base',
  xl: 'w-14 h-14 text-xl',
};

export default function Avatar({ name = '', size = 'md', className }) {
  const initials = getInitials(name);
  const [from, to] = avatarGradient(name);

  return (
    <div
      className={cn(
        'inline-flex items-center justify-center rounded-full font-bold text-white select-none shrink-0',
        `bg-gradient-to-br ${from} ${to}`,
        SIZES[size] ?? SIZES.md,
        className
      )}
      aria-label={name}
    >
      {initials}
    </div>
  );
}
