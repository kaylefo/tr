import type { MainTab } from '../config/app';

const tabs: { id: MainTab; label: string; icon: string }[] = [
  { id: 'convert', label: 'Convert', icon: '¥' },
  { id: 'translate', label: 'Translate', icon: 'Aa' },
  { id: 'history', label: 'History', icon: '◷' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

interface BottomNavProps {
  active: MainTab;
  onChange: (tab: MainTab) => void;
}

export function BottomNav({ active, onChange }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="Main">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`bottom-nav__item${active === tab.id ? ' bottom-nav__item--active' : ''}`}
          aria-current={active === tab.id ? 'page' : undefined}
          onClick={() => onChange(tab.id)}
        >
          <span className="bottom-nav__icon" aria-hidden="true">
            {tab.icon}
          </span>
          <span className="bottom-nav__label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
