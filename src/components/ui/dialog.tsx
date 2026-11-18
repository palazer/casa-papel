import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

/**
 * What is shown over the topmost open dialog: the question before a change alters a month that is over (DESIGN.md
 * §8). Base UI nests a dialog only inside another one's root, so each open dialog says how deep it sits, the deepest
 * renders `over` inside itself, and with no dialog open it stands at the root.
 */
interface Layers {
  open: Array<{ id: string; depth: number }>
  add: (id: string, depth: number) => void
  drop: (id: string) => void
  over: React.ReactNode
}
const LayersContext = React.createContext<Layers | null>(null)
const DepthContext = React.createContext(0)

function DialogLayers({ over, children }: { over: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = React.useState<Layers["open"]>([])
  const add = React.useCallback((id: string, depth: number) => setOpen((o) => (o.some((x) => x.id === id) ? o : [...o, { id, depth }])), [])
  const drop = React.useCallback((id: string) => setOpen((o) => o.filter((x) => x.id !== id)), [])
  const value = React.useMemo(() => ({ open, add, drop, over }), [open, add, drop, over])
  return (
    <LayersContext.Provider value={value}>
      {children}
      {open.length === 0 && over}
    </LayersContext.Provider>
  )
}

/** The deepest open dialog; of two as deep, the one opened last. */
function topmost(open: Layers["open"]): string | null {
  let top: Layers["open"][number] | null = null
  for (const x of open) if (!top || x.depth >= top.depth) top = x
  return top?.id ?? null
}

function Dialog({ open, defaultOpen, onOpenChange, children, ...props }: DialogPrimitive.Root.Props) {
  const id = React.useId()
  const layers = React.useContext(LayersContext)
  const depth = React.useContext(DepthContext) + 1
  const [inner, setInner] = React.useState(defaultOpen ?? false)
  const isOpen = open ?? inner
  const add = layers?.add
  const drop = layers?.drop
  React.useEffect(() => {
    if (!add || !drop || !isOpen) return
    add(id, depth)
    return () => drop(id)
  }, [add, drop, id, depth, isOpen])
  const onTop = layers != null && isOpen && topmost(layers.open) === id
  return (
    <DialogPrimitive.Root
      data-slot="dialog"
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={(...args: Parameters<NonNullable<DialogPrimitive.Root.Props["onOpenChange"]>>) => {
        setInner(args[0])
        onOpenChange?.(...args)
      }}
      {...props}
    >
      {typeof children === "function" ? children : (
        <DepthContext.Provider value={depth}>
          {children}
          {onTop && layers.over}
        </DepthContext.Provider>
      )}
    </DialogPrimitive.Root>
  )
}

/** A dialog shown over the others (`DialogLayers`): it never holds what is shown over the topmost one itself. */
function DialogOver({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          // never taller than the window: what does not fit scrolls inside, under a footer that stays in reach; shaded
          // while a dialog is open over it (the question before a change alters the past, a removal)
          "data-nested-dialog-open:after:pointer-events-none data-nested-dialog-open:after:absolute data-nested-dialog-open:after:inset-0 data-nested-dialog-open:after:z-20 data-nested-dialog-open:after:rounded-xl data-nested-dialog-open:after:bg-black/10 data-nested-dialog-open:after:content-[''] fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto overscroll-contain rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // sticks to the foot of a dialog that scrolls; opaque, so the lines passing under it do not show through
        "sticky -bottom-4 z-10 -mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-[color-mix(in_oklab,var(--muted)_50%,var(--popover))] p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogLayers,
  DialogOver,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
