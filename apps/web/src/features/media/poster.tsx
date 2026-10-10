"use client";
import Image from "next/image";
import { Film } from "lucide-react";
import { useState } from "react";
export function Poster({ url, title }: { url: string | null; title: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <div className="poster">
      {url && failedUrl !== url ? (
        <Image
          unoptimized
          width={400}
          height={600}
          src={url}
          alt={`${title} poster`}
          loading="lazy"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <div className="poster-fallback">
          <Film size={35} aria-hidden="true" />
          <span>Poster unavailable</span>
        </div>
      )}
    </div>
  );
}
