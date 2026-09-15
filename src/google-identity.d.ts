interface GoogleCredentialResponse {
  credential: string;
  select_by: string;
}

interface GoogleIdentityError {
  type: string;
}

interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  auto_select?: boolean;
  error_callback?: (error: GoogleIdentityError) => void;
}

interface GoogleButtonConfiguration {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'small' | 'medium' | 'large';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  width?: number;
  ux_mode?: 'popup' | 'redirect';
}

interface GoogleAccountsId {
  initialize(configuration: GoogleIdConfiguration): void;
  renderButton(parent: HTMLElement, options: GoogleButtonConfiguration): void;
}

interface GoogleIdentity {
  accounts: {
    id: GoogleAccountsId;
  };
}

interface Window {
  google?: GoogleIdentity;
}
