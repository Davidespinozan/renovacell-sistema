// Set de íconos inline (estilo feather/stroke), tomados de los nombres usados
// en el demo. Un solo componente <Icon name="..." /> para todo el shell.
import React from 'react'

export type IconName =
  | 'dashboard' | 'chart' | 'grid' | 'box' | 'usercheck' | 'fingerprint'
  | 'receipt' | 'bag' | 'clock' | 'chat' | 'layers' | 'download' | 'pkg'
  | 'truck' | 'store' | 'bell' | 'image' | 'search' | 'menu' | 'leaf'
  | 'chevronRight' | 'chevronLeft' | 'shield'

const P: Record<IconName, React.ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  chart: <><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  box: <><path d="M21 8l-9-5-9 5v8l9 5 9-5z" /><path d="M3 8l9 5 9-5" /><path d="M12 13v8" /></>,
  usercheck: <><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 11l2 2 4-4" /></>,
  fingerprint: <><path d="M12 11a2 2 0 0 1 2 2c0 3-1 5-2 7" /><path d="M8 13a4 4 0 0 1 8 0c0 2-.5 4-1 5.5" /><path d="M5 13a7 7 0 0 1 14 0c0 1.5-.2 3-.6 4.5" /><path d="M9 4.6a7 7 0 0 1 9 .9" /></>,
  receipt: <><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-1 2z" /><path d="M8 8h8M8 12h8" /></>,
  bag: <><path d="M6 7h12l1 13H5z" /><path d="M9 7a3 3 0 0 1 6 0" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  chat: <><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.2A8 8 0 1 1 21 12z" /></>,
  layers: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>,
  download: <><path d="M12 3v12" /><path d="M7 11l5 4 5-4" /><path d="M4 20h16" /></>,
  pkg: <><path d="M21 8l-9-5-9 5v8l9 5 9-5z" /><path d="M7.5 5.5l9 5" /><path d="M12 13v8" /></>,
  truck: <><rect x="1" y="6" width="13" height="10" rx="1" /><path d="M14 9h4l3 3v4h-7z" /><circle cx="6" cy="18" r="1.8" /><circle cx="18" cy="18" r="1.8" /></>,
  store: <><path d="M3 9l1.5-5h15L21 9" /><path d="M4 9v10h16V9" /><path d="M4 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0" /></>,
  bell: <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M10.5 20a1.8 1.8 0 0 0 3 0" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 16l-5-5L5 21" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  menu: <><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>,
  leaf: <><path d="M20 4C9 4 4 10 4 19c7 0 13-4 15-11" /><path d="M4 19c4-7 9-9 13-9" /></>,
  chevronRight: <><path d="M9 6l6 6-6 6" /></>,
  chevronLeft: <><path d="M15 6l-6 6 6 6" /></>,
  shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></>,
}

export function Icon({ name, ...rest }: { name: IconName } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {P[name]}
    </svg>
  )
}
