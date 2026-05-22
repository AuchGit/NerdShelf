import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import Input  from '@/components/ui/Input';
import Card   from '@/components/ui/Card';

export default function SignupPage() {
  const { signUp, error, clearError } = useAuth();
  const [form, setForm]         = useState({ email: '', password: '', confirm: '' });
  const [loading, setLoading]   = useState(false);
  const [showPw, setShowPw]     = useState(false);
  const [localErr, setLocalErr] = useState('');
  const [done, setDone]         = useState(false);

  const handleChange = (e) => {
    clearError();
    setLocalErr('');
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  };

  const validate = () => {
    if (!form.email || !form.password || !form.confirm) return 'Please fill in all fields.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return 'Invalid email address.';
    if (form.password.length < 6) return 'Password must be at least 6 characters.';
    if (form.password !== form.confirm) return 'Passwords do not match.';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const err = validate();
    if (err) { setLocalErr(err); return; }

    setLoading(true);
    const result = await signUp({ email: form.email, password: form.password });
    setLoading(false);
    if (result.success) setDone(true);
  };

  const displayError = localErr || error;

  if (done) {
    return (
      <Card>
        <Card.Content>
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950">
              <CheckCircle2 className="text-emerald-600 dark:text-emerald-400" size={28} />
            </div>
            <div>
              <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                Check your inbox!
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                We've sent a confirmation email to <strong>{form.email}</strong>.
                After confirming, your account will need admin approval before you can log in.
              </p>
            </div>
            <Link to="/auth/login" className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline">
              ← Back to Sign in
            </Link>
          </div>
        </Card.Content>
      </Card>
    );
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>Create an account</Card.Title>
        <Card.Description>
          Join NerdTools. Your account will need admin approval to access the app.
        </Card.Description>
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
            autoComplete="new-password"
            placeholder="Min. 6 characters"
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

          <Input
            label="Confirm password"
            name="confirm"
            type={showPw ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Repeat password"
            value={form.confirm}
            onChange={handleChange}
            leftElement={<Lock size={15} />}
            required
          />

          {displayError && (
            <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 px-3 py-2 text-sm text-red-700 dark:text-red-400">
              {displayError}
            </div>
          )}

          <Button type="submit" fullWidth loading={loading} size="lg">
            Create account
          </Button>
        </form>
      </Card.Content>
      <Card.Footer className="justify-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Already have an account?{' '}
          <Link to="/auth/login" className="font-medium text-brand-600 dark:text-brand-400 hover:underline">
            Sign in
          </Link>
        </p>
      </Card.Footer>
    </Card>
  );
}
