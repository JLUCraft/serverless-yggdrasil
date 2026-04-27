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

export default function App() {
  return (
    <Router root={Layout}>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/register/verify" component={VerifyEmail} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/skins" component={Skins} />
      <Route path="/premium" component={Premium} />
      <Route path="/admin" component={Admin} />
      <Route path="/admin/users" component={Users} />
    </Router>
  );
}
