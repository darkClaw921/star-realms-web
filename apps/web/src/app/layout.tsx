import type { Metadata, Viewport } from 'next'
import { Commissioner, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'
import { IconSprite } from '@/components/Icons'
import './globals.css'

// Кириллические подмножества обязательны: интерфейс и все карты на русском, и
// без них браузер молча подменяет шрифт посреди фразы. По этой же причине сюда
// не годится ни один шрифт, у которого в Google Fonts есть только
// `cyrillic-ext` без базовой кириллицы, — названия карт набраны дисплейным, и
// провал был бы виден на каждой.
//
// Commissioner на названиях и IBM Plex Sans в описаниях: первый спокойный
// гротеск, который держит строй в наборе заглавными, второй разборчив в узкой
// колонке текста свойства и не спорит с ним по рисунку.
const body = IBM_Plex_Sans({
  subsets: ['latin', 'cyrillic'], weight: ['400', '500', '600'], variable: '--f-body', display: 'swap',
})
const display = Commissioner({
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
    // Классы шрифтов висят на <html>, а не на <body>, и это не косметика.
    // next/font объявляет свои --f-* внутри класса; объявленные на <body>, они
    // не видны правилу на :root — то есть ровно там, где из них собираются
    // --font-display и --font-body. Пустая подстановка делала объявление
    // синтаксически неверным, оно отбрасывалось целиком, и весь интерфейс
    // молча набирался системным шрифтом с засечками.
    <html
      lang="ru"
      className={`${body.variable} ${display.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body>
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
