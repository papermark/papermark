"use client";

import Image, { ImageProps } from "next/image";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export function BlurImage(props: ImageProps) {
  const [loading, setLoading] = useState(true);
  const [src, setSrc] = useState(props.src);
  useEffect(() => setSrc(props.src), [props.src]); // update the `src` value when the `prop.src` value changes

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    setLoading(false);
    const target = e.target as HTMLImageElement;
    if (target.naturalWidth <= 16 && target.naturalHeight <= 16) {
      setSrc(`/api/og/avatar/${encodeURIComponent(props.alt)}`);
    }
  };

  return (
    <Image
      {...props}
      src={src}
      alt={props.alt}
      className={cn(loading ? "blur-[2px]" : "blur-0", props.className)}
      onLoad={handleLoad}
      onError={() => {
        setSrc(`/api/og/avatar/${encodeURIComponent(props.alt)}`);
      }}
      unoptimized
    />
  );
}
