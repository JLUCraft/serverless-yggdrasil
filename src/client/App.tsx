import type { Component } from 'solid-js';
import { Router, Route } from '@solidjs/router';
import Layout from './components/Layout';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import VerifyEmail from './pages/VerifyEmail';
import Dashboard from './pages/Dashboard';
import Skins from './pages/Skins';
import Premium from './pages/Premium';
import Admin from './pages/Admin';
import Users from './pages/Users';
import Gate from './components/Gate';
import type { Role } from './lib/api';

const entry = '/login';
const missing = '/404';

function protect(Page: Component, role?: Role): Component {
  if (role !== undefined) {
    return () => (
      <Gate role={role} login={entry} denied={missing}>
        <Page />
      </Gate>
    );
  }
  return () => (
    <Gate login={entry} denied={missing}>
      <Page />
    </Gate>
  );
}

function NotFound() {
  return (
    <div class="flex min-h-[50vh] items-center justify-center text-center">
      <div>
        <div class="text-6xl font-extrabold text-base-content/20">404</div>
        <p class="mt-3 text-sm text-base-content/50">页面不存在或无权访问</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Router root={Layout}>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/register/verify" component={VerifyEmail} />
      <Route path="/dashboard" component={protect(Dashboard)} />
      <Route path="/skins" component={protect(Skins)} />
      <Route path="/premium" component={protect(Premium)} />
      <Route path="/admin" component={protect(Admin, 'admin')} />
      <Route path="/admin/users" component={protect(Users, 'admin')} />
      <Route path="/404" component={NotFound} />
      <Route path="*404" component={NotFound} />
    </Router>
  );
}
