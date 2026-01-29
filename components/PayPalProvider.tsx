'use client';

import { PayPalScriptProvider } from '@paypal/react-paypal-js';

export default function PayPalProvider({ children }: { children: React.ReactNode }) {
    const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;

    // If no PayPal client ID, just render children without provider
    if (!clientId) {
        return <>{children}</>;
    }

    return (
        <PayPalScriptProvider
            options={{
                clientId: clientId,
                currency: 'USD',
                intent: 'capture',
            }}
        >
            {children}
        </PayPalScriptProvider>
    );
}
