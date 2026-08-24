import type { Metadata, Viewport } from 'next'
import { Fira_Sans_Condensed, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'
import { IconSprite } from '@/components/Icons'
import './globals.css'

// Cyrillic subsets are required: the interface and every card is in Russian, and
// without them the browser silently swaps to a system face mid-sentence.
//
// The display face is Fira Sans Condensed rather than IBM Plex Sans Condensed,
// which ships only `cyrillic-ext` — no basic Russian alphabet. Card names are set
// in the display face, so that gap would have been visible on every card.
const body = IBM_Plex_Sans({
  subsets: ['latin', 'cyrillic'], weight: ['400', '500', '600'], variable: '--f-body', display: 'swap',
})
const display = Fira_Sans_Condensed({
  subsets: ['latin', 'cyrillic'], weight: ['600', '700'], variable: '--f-display', display: 'swap',
})
const mono = IBM_Plex_Mono({
  subsets: ['latin', 'cyrillic'], weight: ['500', '600'], variable: '--f-mono', display: 'swap',
})

export const metadata: Metadata = {
  title: 'Звёздные империи',
  description: 'Веб-версия базового набора настольной игры «Звёздные империи» (Star Realms).',
}

export const viewport: Viewport = {
  themeColor: '#07090d',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    // suppressHydrationWarning: скрипт ниже правит style у <html> ДО гидратации,
    // поэтому серверная разметка заведомо не совпадёт с клиентской. Это
    // единственный способ применить сохранённый масштаб без скачка, и подавление
    // здесь точечное — только на этом элементе.
    <html lang="ru" suppressHydrationWarning>
      <body className={`${body.variable} ${display.variable} ${mono.variable}`}>
        <style>{`:root{
          --font-body: var(--f-body), system-ui, sans-serif;
          --font-display: var(--f-display), 'Helvetica Neue', sans-serif;
          --font-mono: var(--f-mono), ui-monospace, monospace;
        }`}</style>
        {/*
          * Применяем сохранённые настройки ДО первой отрисовки. Иначе карты
          * успевают появиться в размере по умолчанию и на глазах перескакивают
          * в пользовательский — заметный и неприятный скачок.
          */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=JSON.parse(localStorage.getItem('sr:settings')||'{}');
var r=document.documentElement;
if(s.cardScale)r.style.setProperty('--card-scale',String(Math.min(1.6,Math.max(0.7,s.cardScale))));
if(s.textScale)r.style.setProperty('--card-text-scale',String(Math.min(1.4,Math.max(0.85,s.textScale))));
}catch(e){}})()`,
          }}
        />
        {/* Небо. Отдельным элементом, а не третьим слоем на body: рукав
          * галактики и виньетка стоят на месте, пока два звёздных поля за
          * ними медленно плывут.
          *
          * Порядок слоёв — глубина: скопления галактик дальше всех, метеоры
          * пролетают перед ними, и всё это накрывает пелена — рукав и
          * виньетка, которые не двигаются. Пелена последняя именно потому,
          * что гасит углы: под галактиками она гасила бы только пустоту. */}
        <div className="sky" aria-hidden="true">
          <div className="sky__deep">
            <i className="galaxy galaxy--a" />
            <i className="galaxy galaxy--b" />
            <i className="galaxy galaxy--c" />
            <i className="galaxy galaxy--d" />
          </div>
          <div className="sky__meteors">
            <i className="meteor meteor--1" />
            <i className="meteor meteor--2" />
            <i className="meteor meteor--3" />
            <i className="meteor meteor--4" />
          </div>
          <div className="sky__veil" />
        </div>
        <IconSprite />
        {children}
      </body>
    </html>
  )
}
