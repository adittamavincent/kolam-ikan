import React from 'react';
import { Plus } from 'lucide-react';

interface NavigatorCreateButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon?: React.ReactNode;
}

export const NavigatorCreateButton = React.forwardRef<HTMLButtonElement, NavigatorCreateButtonProps>(
  ({ label, icon, className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors text-gray-500 hover:bg-gray-100 hover:text-gray-900 ${className || ''}`}
        {...props}
      >
        {icon || <Plus className="h-4 w-4" />}
        <span>{label}</span>
      </button>
    );
  }
);

NavigatorCreateButton.displayName = 'NavigatorCreateButton';
