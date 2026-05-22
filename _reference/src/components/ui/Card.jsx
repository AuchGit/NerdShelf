import { cn } from '@/utils/helpers';

function Card({ className, children, ...props }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function CardHeader({ className, children, ...props }) {
  return (
    <div
      className={cn('flex flex-col gap-1 p-5 pb-4', className)}
      {...props}
    >
      {children}
    </div>
  );
}

function CardTitle({ className, children, ...props }) {
  return (
    <h3
      className={cn('font-display text-lg font-bold text-slate-900 dark:text-white', className)}
      {...props}
    >
      {children}
    </h3>
  );
}

function CardDescription({ className, children, ...props }) {
  return (
    <p
      className={cn('text-sm text-slate-500 dark:text-slate-400', className)}
      {...props}
    >
      {children}
    </p>
  );
}

function CardContent({ className, children, ...props }) {
  return (
    <div className={cn('p-5 pt-0', className)} {...props}>
      {children}
    </div>
  );
}

function CardFooter({ className, children, ...props }) {
  return (
    <div
      className={cn(
        'flex items-center p-5 pt-4 border-t border-slate-100 dark:border-slate-800',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

Card.Header      = CardHeader;
Card.Title       = CardTitle;
Card.Description = CardDescription;
Card.Content     = CardContent;
Card.Footer      = CardFooter;

export default Card;
