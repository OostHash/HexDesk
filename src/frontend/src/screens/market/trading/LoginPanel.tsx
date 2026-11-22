import { useState } from "react";
import { openExternal } from "../../../api/links";
import { useLogin } from "../../../api/trading";
import { Button } from "../../../primitives/actions";
import { Alert, Card } from "../../../primitives/display";
import { Checkbox, FormField, Input } from "../../../primitives/forms";

const ACCOUNT_URL = "https://warframe.market/settings/account";

/** warframe.market login (email and password only). */
export function LoginPanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const login = useLogin();

  return (
    <div className="flex flex-1 items-start justify-center p-6">
      <Card as="section" padding="lg" className="flex w-full max-w-sm flex-col gap-3">
        <h2 className="text-base font-semibold">Connect warframe.market</h2>
        <p className="text-sm text-muted">Log in to view live orders, manage listings, and receive trade whispers.</p>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (email && password) login.mutate({ email, password, remember });
          }}
        >
          <FormField label="Email">
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
            />
          </FormField>
          <FormField label="Password">
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
            />
          </FormField>
          <Checkbox checked={remember} onCheckedChange={setRemember}>
            Remember me on this computer
          </Checkbox>
          {login.isError && (
            <Alert tone="danger" title="Could not log in.">
              {login.error.message || String(login.error)}
            </Alert>
          )}
          <Button type="submit" variant="primary" loading={login.isPending} disabled={!email || !password}>
            Log in
          </Button>
        </form>
        <p className="text-xs text-muted">
          Using Steam, Xbox, Discord or GitHub to log in to warframe.market? Create email and password credentials first under{" "}
          <button type="button" className="text-accent underline" onClick={() => void openExternal(ACCOUNT_URL)}>
            warframe.market account settings
          </button>
          , then use those here.
        </p>
      </Card>
    </div>
  );
}
