import './styles.css';
import { createApi } from './api.js';
import { createController } from './controller.js';
import { renderKeyScreen } from './keyScreen.js';

const api = createApi();
const appRoot = document.getElementById('app');
const overlay = document.getElementById('key-overlay');

const controller = createController({
  api,
  render: (state) => {
    const { snapshot } = state;
    appRoot.textContent = `Instantané v${snapshot.version} du ${snapshot.fetchedAt} : `
      + `${snapshot.domain.teams.length} teams, ${snapshot.domain.issues.length} issues`
      + (state.error ? ` — ${state.error}` : '');
  },
  showKeyScreen: (reason) => renderKeyScreen(overlay, {
    api,
    reason,
    onValidated: () => controller.start(),
  }),
});

controller.start();
