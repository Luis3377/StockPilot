import { Compass } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { LinkButton } from '../ui/Button';

export function NotFound() {
  return (
    <EmptyState icon={<Compass className="size-6" />} title="That page doesn’t exist" actions={<LinkButton to="/" variant="primary">Go to Overview</LinkButton>}>
      The link may be out of date.
    </EmptyState>
  );
}
