/* @refresh reload */
import { render } from 'solid-js/web'
import './index.css'
import App from './App.tsx'
import siteConfig from '../site.config.ts'

document.title = siteConfig.appName

const root = document.getElementById('root')

render(() => <App />, root!)
