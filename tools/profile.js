// Charge profile.json (perso, ignoré par git) ; à créer depuis profile.example.json.
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'profile.json');

module.exports = () => {
  if (!fs.existsSync(FILE)) throw new Error('profile.json manquant : cp profile.example.json profile.json puis édite-le.');
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
};
