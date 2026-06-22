import React, { useRef } from "react";

type SpotlightCardProps = React.HTMLAttributes<HTMLElement> & {
  as?: "div" | "form" | "section";
  spotlightColor?: string;
};

export function SpotlightCard({
  as = "div",
  spotlightColor = "rgba(92, 214, 175, 0.18)",
  className = "",
  style,
  onMouseMove,
  children,
  ...rest
}: SpotlightCardProps): JSX.Element {
  const ref = useRef<HTMLElement | null>(null);
  const Element = as;

  const handleMouseMove = (event: React.MouseEvent<HTMLElement>) => {
    const element = ref.current;
    if (element) {
      const rect = element.getBoundingClientRect();
      element.style.setProperty("--rb-x", `${event.clientX - rect.left}px`);
      element.style.setProperty("--rb-y", `${event.clientY - rect.top}px`);
      element.style.setProperty("--rb-spotlight", spotlightColor);
    }
    onMouseMove?.(event);
  };

  return (
    <Element
      ref={ref as React.Ref<any>}
      className={`rb-spotlight ${className}`.trim()}
      style={{ "--rb-spotlight": spotlightColor, ...style } as React.CSSProperties}
      onMouseMove={handleMouseMove}
      {...rest}
    >
      {children}
    </Element>
  );
}

export function ShinyText({
  children,
  disabled = false
}: {
  children: React.ReactNode;
  disabled?: boolean;
}): JSX.Element {
  return <span className={disabled ? "rb-shiny-text disabled" : "rb-shiny-text"}>{children}</span>;
}

export function MagneticButton({
  children,
  className = "",
  disabled,
  onMouseMove,
  onMouseLeave,
  style,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null);

  const handleMouseMove = (event: React.MouseEvent<HTMLButtonElement>) => {
    const element = ref.current;
    if (element && !disabled) {
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      element.style.setProperty("--rb-magnet-x", `${x * 0.18}px`);
      element.style.setProperty("--rb-magnet-y", `${y * 0.18}px`);
    }
    onMouseMove?.(event);
  };

  const handleMouseLeave = (event: React.MouseEvent<HTMLButtonElement>) => {
    const element = ref.current;
    if (element) {
      element.style.setProperty("--rb-magnet-x", "0px");
      element.style.setProperty("--rb-magnet-y", "0px");
    }
    onMouseLeave?.(event);
  };

  return (
    <button
      ref={ref}
      className={`rb-magnetic ${className}`.trim()}
      disabled={disabled}
      style={style}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      {...rest}
    >
      {children}
    </button>
  );
}
