import { Search } from "lucide-react";

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel?: string;
  className?: string;
};

/**
 * Canonical search input — bare row, borderBottom hairline,
 * flex-sibling magnifying-glass icon in theme accent color.
 * Consumed by Journal, Help, CardPicker, and Admin search.
 * One source of truth: change this component, all four follow.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className = "",
}: SearchInputProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Search
        size={14}
        strokeWidth={1.5}
        style={{
          color: "var(--accent, var(--gold))",
          opacity: "var(--ro-plus-10, 0.7)",
          flexShrink: 0,
        }}
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className="w-full bg-transparent py-1 font-display text-[15px] italic text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
        style={{
          borderBottom:
            "1px solid color-mix(in oklab, var(--accent, var(--gold)) 20%, transparent)",
        }}
      />
    </div>
  );
}