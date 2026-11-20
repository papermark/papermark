// Inspired by Steven Tey's flawless search implementation in dub.co
// https://github.com/dubinc/dub/blob/450749a29ca2ec2486fb2272a73cfbd8a5d80b3f/apps/web/ui/shared/search-box.tsx
import { useRouter } from "next/router";

import {
  memo,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { CircleXIcon, SearchIcon } from "lucide-react";
import { useDebouncedCallback } from "use-debounce";

import { cn } from "@/lib/utils";

import LoadingSpinner from "./ui/loading-spinner";

type SearchBoxProps = {
  value: string;
  loading?: boolean;
  showClearButton?: boolean;
  onChange: (value: string) => void;
  onChangeDebounced?: (value: string) => void;
  debounceTimeoutMs?: number;
  inputClassName?: string;
  leftIconClassName?: string;
  clearIconClassName?: string;
  placeholder?: string;
};

const SearchBox = forwardRef(
  (
    {
      value,
      loading,
      showClearButton = true,
      onChange,
      onChangeDebounced,
      debounceTimeoutMs = 500,
      inputClassName,
      leftIconClassName,
      clearIconClassName,
      placeholder = "Search...",
    }: SearchBoxProps,
    forwardedRef,
  ) => {
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(forwardedRef, () => inputRef.current);

    const debounced = useDebouncedCallback(
      (value) => onChangeDebounced?.(value),
      debounceTimeoutMs,
    );

    const onKeyDown = useCallback((e: KeyboardEvent) => {
      const target = e.target as HTMLElement;

      // Cmd+K (macOS) / Ctrl+K (Windows/Linux) focuses the search input and
      // selects any existing text so the field is highlighted. This works
      // even while typing in another input, just like a global command.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }

      // only focus on filter input when:
      // - user is not typing in an input or textarea
      // - there is no existing modal backdrop (i.e. no other modal is open)
      if (
        e.key === "/" &&
        target.tagName !== "INPUT" &&
        target.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }, []);

    useEffect(() => {
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }, [onKeyDown]);

    return (
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
          {loading && value.length > 0 ? (
            <LoadingSpinner className="h-4 w-4" />
          ) : (
            <SearchIcon
              className={cn("h-4 w-4 text-muted-foreground", leftIconClassName)}
            />
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          className={cn(
            "peer w-full cursor-text rounded-md border border-border bg-white px-10 text-foreground outline-none placeholder:text-muted-foreground dark:bg-gray-800 sm:text-sm",
            "transition-all focus:border-gray-500 focus:ring-0",
            inputClassName,
          )}
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            debounced(e.target.value);
          }}
          autoCapitalize="none"
        />
        {showClearButton && value.length > 0 && (
          <button
            onClick={() => {
              onChange("");
              onChangeDebounced?.("");
            }}
            className="pointer-events-auto absolute inset-y-0 right-0 flex items-center pr-4"
          >
            <CircleXIcon
              className={cn("h-4 w-4 text-muted-foreground", clearIconClassName)}
            />
          </button>
        )}
      </div>
    );
  },
);
SearchBox.displayName = "SearchBox";
const MemoizedSearchBox = memo(SearchBox);

export function SearchBoxPersisted({
  urlParam = "search",
  ...props
}: { urlParam?: string } & Partial<SearchBoxProps>) {
  const router = useRouter();
  const queryParams = router.query;

  const initial =
    typeof queryParams[urlParam] === "string" ? queryParams[urlParam] : "";

  const [value, setValue] = useState(initial);
  const [debouncedValue, setDebouncedValue] = useState(initial);

  useEffect(() => {
    // Wait until the router has hydrated its dynamic route params (e.g. [id],
    // [...name]). Pushing to `router.pathname` while `router.query` is still
    // empty would leave the dynamic segments un-interpolated and throw a
    // Next.js "href interpolation failed" error on dynamic routes.
    if (!router.isReady) return;

    const currentValue =
      typeof router.query[urlParam] === "string"
        ? (router.query[urlParam] as string)
        : "";

    // Skip no-op pushes (also avoids a redundant push on initial mount).
    if (currentValue === debouncedValue) return;

    const currentQuery = { ...router.query };

    if (debouncedValue === "") {
      delete currentQuery[urlParam];
      delete currentQuery.page;
      delete currentQuery.limit;
    } else {
      currentQuery[urlParam] = debouncedValue;
    }

    // For custom domains, preserve the clean URL structure
    const isCustomDomain = !!(router.query.domain && router.query.slug);

    router.push(
      {
        pathname: router.pathname,
        query: currentQuery,
      },
      isCustomDomain ? `/${router.query.slug}` : undefined, // Preserve custom domain URL
      { shallow: true },
    );
    // This is intentionally keyed on the debounced input value and the router
    // ready state. Adding the full router/query objects can cause feedback
    // loops with shallow routing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedValue, router.isReady]);

  useEffect(() => {
    const queryValue =
      typeof queryParams[urlParam] === "string" ? queryParams[urlParam] : "";
    if (queryValue !== value && value === debouncedValue) {
      setValue(queryValue);
      setDebouncedValue(queryValue);
    }
    // Keep this tied to the specific URL param only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryParams[urlParam]]);

  return (
    <MemoizedSearchBox
      value={value}
      onChange={setValue}
      onChangeDebounced={setDebouncedValue}
      {...props}
    />
  );
}
