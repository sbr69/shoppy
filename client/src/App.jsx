import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Landing />} />
        {/* Dashboard route will be added in Phase 2 */}
      </Routes>
    </Router>
  );
}

export default App;
