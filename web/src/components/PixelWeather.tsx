type WeatherKind = 'sun' | 'cloud' | 'rain' | 'snow' | 'storm' | 'fog';

const GLYPHS: Record<WeatherKind, string[]> = {
  sun: [
    '00100', '01110', '11111', '01110', '00100',
    '10101', '00100', '10101',
  ],
  cloud: [
    '00000', '01110', '11111', '11111', '01110',
    '00000', '00000', '00000',
  ],
  rain: [
    '00000', '01110', '11111', '11111', '01110',
    '01010', '00100', '01010',
  ],
  snow: [
    '00100', '01110', '11111', '01110', '00100',
    '01010', '00100', '01010',
  ],
  storm: [
    '00000', '01110', '11111', '11111', '01110',
    '00110', '01100', '00110',
  ],
  fog: [
    '00000', '11111', '01110', '11111', '01110',
    '00000', '00000', '00000',
  ],
};

export function weatherKind(desc = ''): WeatherKind {
  const d = desc.toLowerCase();
  if (/雷|storm|thunder/.test(d)) return 'storm';
  if (/雨|rain|drizzle|shower|毛毛雨/.test(d)) return 'rain';
  if (/雪|snow|sleet/.test(d)) return 'snow';
  if (/雾|fog|霾|haze|mist/.test(d)) return 'fog';
  if (/晴|clear|sun/.test(d)) return 'sun';
  return 'cloud';
}

interface Props {
  desc?: string;
  temp?: number | string;
  city?: string;
  className?: string;
}

export default function PixelWeather({ desc = '', temp, city, className = '' }: Props) {
  const kind = weatherKind(desc);
  const rows = GLYPHS[kind];
  const label = [temp != null ? `${temp}°` : '', desc, city].filter(Boolean).join(' · ');

  return (
    <div className={`pixel-weather ${className}`} title={label} aria-label={label}>
      <div className="pixel-weather-icon" aria-hidden>
        {rows.map((row, r) => (
          <div key={r} className="pixel-weather-row">
            {row.split('').map((bit, c) => (
              <span key={c} className={`pixel-weather-dot${bit === '1' ? ' on' : ''}`} />
            ))}
          </div>
        ))}
      </div>
      {temp != null && (
        <span className="pixel-weather-temp font-mono tabular-nums">{temp}°</span>
      )}
    </div>
  );
}
