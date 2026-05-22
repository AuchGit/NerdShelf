import { useNavigate } from 'react-router-dom';
import { Clock, LogOut, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import Card   from '@/components/ui/Card';
import { useState } from 'react';

export default function PendingPage() {
  const { signOut, refreshProfile, profile } = useAuth();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth/login');
  };

  const handleRefresh = async () => {
    setChecking(true);
    await refreshProfile();
    setChecking(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-surface-dark flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-fade-in">
        {/* Brand */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white font-bold text-lg">
            N
          </div>
          <span className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">
            NerdTools
          </span>
        </div>

        <Card>
          <Card.Content>
            <div className="flex flex-col items-center gap-5 py-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950 animate-pulse-slow">
                <Clock className="text-amber-600 dark:text-amber-400" size={32} />
              </div>

              <div>
                <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">
                  Awaiting Approval
                </h1>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                  Your account (<strong>{profile?.email}</strong>) has been created and is waiting
                  for an administrator to approve access.
                </p>
              </div>

              <div className="w-full rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/50 px-4 py-3 text-sm text-amber-700 dark:text-amber-300 text-left space-y-1">
                <p className="font-semibold">What happens next?</p>
                <ul className="list-disc list-inside space-y-1 text-amber-600 dark:text-amber-400">
                  <li>An admin will review your signup request</li>
                  <li>You'll be able to sign in once approved</li>
                  <li>Click "Check Status" anytime to refresh</li>
                </ul>
              </div>

              <div className="flex gap-2 w-full">
                <Button variant="outline" fullWidth onClick={handleSignOut} leftIcon={<LogOut size={15} />}>
                  Sign out
                </Button>
                <Button fullWidth onClick={handleRefresh} loading={checking} leftIcon={<RefreshCw size={15} />}>
                  Check Status
                </Button>
              </div>
            </div>
          </Card.Content>
        </Card>
      </div>
    </div>
  );
}
