const { isAuthed } = require('./_auth');
const { getData, setData } = require('./_store');

const EMPTY_DATA = {
  profiles: [],
  banks: [],
  transactions: [],
  bankTransactions: [],
  places: [],
  expenseCategories: [],
  expenses: [],
  assets: [],
  settings: { rates: { USD: 1, EUR: 1 } },
};

module.exports = async (req, res) => {
  if (!isAuthed(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  if (req.method === 'GET') {
    const stored = await getData();
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(stored || JSON.stringify(EMPTY_DATA));
    return;
  }

  if (req.method === 'PUT') {
    // Vercel's default Node body parser already rejects oversized/malformed
    // bodies before this handler runs; req.body is a parsed JSON object here.
    const body = req.body;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }
    await setData(JSON.stringify(body));
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
