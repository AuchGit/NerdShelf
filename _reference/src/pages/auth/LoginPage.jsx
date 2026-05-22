import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import Input  from '@/components/ui/Input';
import Card   from '@/components/ui/Card';

export default function LoginPage() {
  const { signIn, error, clearError } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const from      = location.state?.from?.pathname ?? '/dashboard';

  const [form, setForm]       = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw]   = useState(false);
  const [localErr, setLocalErr] = useState('');

  const handleChange = (e) => {
    clearError();
    setLocalErr('');
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password) {
      setLocalErr('Please fill in all fields.');
      return;
    }
    setLoading(true);
    const result = await signIn(form);
    setLoading(false);
    if (result.success) navigate(from, { replace: true });
  };

  const displayError = localErr || error;

  return (
    <Card>
      <Card.Header>
        <Card.Title>Welcome back</Card.Title>
        <Card.Description>Sign in to your account to continue.</Card.Description>
      </Card.Header>
      <Card.Content>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <Input
            label="Email address"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={form.email}
            onChange={handleChange}
            leftElement={<Mail size={15} />}
            required
          />

          <Input
            label="Password"
            name="password"
            type={showPw ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="••••••••"
            value={form.password}
            onChange={handleChange}
            leftElement={<Lock size={15} />}
            rightElement={
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                tabIndex={-1}
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            }
            required
          />

          {displayError && (
            <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 px-3 py-2 text-sm text-red-700 dark:text-red-400">
              {displayError}
            </div>
          )}

          <Button type="submit" fullWidth loading={loading} size="lg">
            Sign in
          </Button>
        </form>
      </Card.Content>
      <Card.Footer className="justify-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Don't have an account?{' '}
          <Link to="/auth/signup" className="font-medium text-brand-600 dark:text-brand-400 hover:underline">
            Sign up
          </Link>
        </p>
      </Card.Footer>
    </Card>
  );
}
