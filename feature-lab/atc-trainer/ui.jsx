function cn(...classes) {
  return classes.filter(Boolean).join(' ')
}

export function Button({
  variant = 'default',
  size = 'default',
  className,
  ...props
}) {
  return (
    <button
      className={cn('uiButton', `uiButtonVariant--${variant}`, `uiButtonSize--${size}`, className)}
      {...props}
    />
  )
}

export function Card({ className, ...props }) {
  return <section className={cn('uiCard', className)} {...props} />
}

export function CardHeader({ className, ...props }) {
  return <div className={cn('uiCardHeader', className)} {...props} />
}

export function CardTitle({ className, ...props }) {
  return <div className={cn('uiCardTitle', className)} {...props} />
}

export function CardDescription({ className, ...props }) {
  return <div className={cn('uiCardDescription', className)} {...props} />
}

export function CardContent({ className, ...props }) {
  return <div className={cn('uiCardContent', className)} {...props} />
}

export function CardFooter({ className, ...props }) {
  return <div className={cn('uiCardFooter', className)} {...props} />
}

export function Badge({ variant = 'secondary', className, ...props }) {
  return <span className={cn('uiBadge', `uiBadge--${variant}`, className)} {...props} />
}

export function Tabs({ className, ...props }) {
  return <div className={cn('uiTabs', className)} {...props} />
}

export function TabsList({ className, ...props }) {
  return <div className={cn('uiTabsList', className)} {...props} />
}

export function TabsTrigger({ active, className, ...props }) {
  return (
    <button
      className={cn('uiTabsTrigger', active && 'uiTabsTrigger--active', className)}
      aria-pressed={active}
      {...props}
    />
  )
}

export function Progress({ value = 0, className }) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div className={cn('uiProgress', className)} aria-hidden="true">
      <div className="uiProgress__bar" style={{ width: `${clamped}%` }} />
    </div>
  )
}

export function Textarea({ className, ...props }) {
  return <textarea className={cn('uiTextarea', className)} {...props} />
}
