import { Banner, Button, Card, Page, Stack, TextField, TextStyle } from "@shopify/polaris";
import { useState } from "react";
import { useAuthenticatedFetch } from "../hooks/useAuthenticatedFetch";
import '../App.css'

export default function HomePage() {
  const authenticatedFetch = useAuthenticatedFetch();
  const [token, setToken] = useState("");
  const [isLinking, setIsLinking] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function linkDashboardUser() {
    setIsLinking(true);
    setError("");
    setResult(null);

    try {
      const request = await authenticatedFetch("/api/dashboard/link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token }),
      });
      const response = await request.json();

      if (!request.ok || !response.success) {
        throw new Error(response.error || "Failed to link dashboard user");
      }

      setResult(response);
      setToken("");
    } catch (linkError) {
      setError(linkError.message);
    } finally {
      setIsLinking(false);
    }
  }

  return (
    <Page fullWidth>
      <div className="home-input-page">
        <Card sectioned>
          <Stack vertical spacing="loose">
            <TextStyle variation="strong">Link this Shopify store to a dashboard user</TextStyle>
            <TextField
              label="Dashboard token"
              value={token}
              onChange={setToken}
              autoComplete="off"
              placeholder="Paste the token generated in ShopifyDashboard"
              disabled={isLinking}
            />
            <div className="SubmitBtn">
              <Button
                primary
                onClick={linkDashboardUser}
                loading={isLinking}
                disabled={!token.trim()}
              >
                Link Store
              </Button>
            </div>
            {error ? (
              <Banner status="critical">
                <p>{error}</p>
              </Banner>
            ) : null}
            {result ? (
              <Banner status="success">
                <p>{result.message}</p>
                <p>
                  {result.linkedUser?.name} is linked to {result.shop?.storeName}. Saved{" "}
                  {result.orders?.savedCount || 0} orders to MongoDB.
                </p>
              </Banner>
            ) : null}
          </Stack>
        </Card>
      </div>
    </Page>
  );
}
