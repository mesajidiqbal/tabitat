import { useState } from "preact/hooks";
import { faviconSrc } from "../format";
import { IconGlobe } from "../icons";
import s from "./rows.module.css";

/** 16 px favicon from the local favicon endpoint; globe when there is none (size reserved). */
export function Favicon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? "" : faviconSrc(url);
  if (!src) return <IconGlobe class={s.fav} />;
  return (
    <img
      class={s.fav}
      src={src}
      width={16}
      height={16}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
