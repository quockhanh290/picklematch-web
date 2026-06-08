import { ScrollViewStyleReset } from 'expo-router/html'
import type { ReactNode } from 'react'

export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />

        <ScrollViewStyleReset />

        <style dangerouslySetInnerHTML={{ __html: `
          * {
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            text-rendering: optimizeLegibility;
          }
          
          /* Optional: Make text selection look slightly nicer */
          ::selection {
            background-color: #E1F5EE;
            color: #0F6E56;
          }
        ` }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
