import './globals.css';

export const metadata = {
  title: 'City Builder — build your metropolis',
  description:
    'An isometric city-building game in your browser. Zone residential, commercial and industrial districts, lay roads, keep the power on and grow a hamlet into a metropolis. Inspired by Cities: Skylines.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
