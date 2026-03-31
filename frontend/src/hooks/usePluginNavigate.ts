// Re-Export fuer Plugins: Plugins koennen react-router-dom nicht direkt
// importieren (liegt ausserhalb von node_modules). Stattdessen:
//   import { useNavigate } from '@mike/hooks/usePluginNavigate';
export { useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
