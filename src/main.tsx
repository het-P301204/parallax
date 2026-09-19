/**
 * Entry point.
 *
 * `StrictMode` is on deliberately. It double-invokes effects and renders in
 * development, which is exactly the pressure an interface holding one large
 * immutable analysis should be under: if a view is quietly mutating the report
 * it was handed, StrictMode is what surfaces it.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { ErrorBoundary } from './ui/ErrorBoundary.tsx'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('The #root element is missing from index.html.')

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
