
import { render } from 'solid-js/web'
import './index.css'
import App from './App.tsx'
import siteConfig from '../../site.config.json'
import { initTheme } from './lib/theme.ts'

document.title = siteConfig.appName
initTheme()

const root = document.getElementById('root')

render(() => <App />, root!)
