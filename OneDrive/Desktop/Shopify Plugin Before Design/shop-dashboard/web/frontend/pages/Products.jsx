import { Card, Layout, Page } from "@shopify/polaris";
import React, { useEffect, useState } from "react";
import { useAuthenticatedFetch } from "../hooks/useAuthenticatedFetch";

function Products() {
  const authenticatedFetch = useAuthenticatedFetch();
  const [stats, setStats] = useState({
    totalOrders: 0,
    savedOrders: 0,
    totalProducts: 0,
    mongoStatus: "Checking MongoDB connection...",
    storeName: "",
  });

  useEffect(() => {
    let isMounted = true;

    async function loadProductPageData() {
      try {
        const [storeInfoRequest, productsRequest, ordersRequest] = await Promise.all([
          authenticatedFetch("/api/store/info"),
          authenticatedFetch("/api/products/count"),
          authenticatedFetch("/api/orders/all"),
        ]);

        const storeInfoResponse = await storeInfoRequest.json();
        const productsResponse = await productsRequest.json();
        const ordersResponse = await ordersRequest.json();

        if (!storeInfoRequest.ok || !storeInfoResponse.success) {
          throw new Error(storeInfoResponse.error || "Failed to load store information");
        }

        const storeName =
          storeInfoResponse.data?.name ||
          storeInfoResponse.data?.myshopifyDomain ||
          "";
        const allOrders = Array.isArray(ordersResponse?.data) ? ordersResponse.data : [];

        const saveRequest = await authenticatedFetch("/api/orders/save", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ orders: allOrders }),
        });
        const saveResponse = await saveRequest.json();

        if (!saveRequest.ok || !saveResponse.success) {
          throw new Error(saveResponse.error || "Failed to save orders to MongoDB");
        }

        let savedOrders = saveResponse.savedCount || 0;

        if (storeName) {
          const storedOrdersRequest = await authenticatedFetch(
            `/api/orders/store?storename=${encodeURIComponent(storeName)}`
          );
          const storedOrdersResponse = await storedOrdersRequest.json();

          if (storedOrdersRequest.ok && storedOrdersResponse.success) {
            savedOrders = Array.isArray(storedOrdersResponse.data?.orders)
              ? storedOrdersResponse.data.orders.length
              : savedOrders;
          }
        }

        if (!isMounted) {
          return;
        }

        setStats({
          totalOrders: allOrders.length,
          savedOrders,
          totalProducts: productsResponse?.count || 0,
          mongoStatus: `MongoDB connected: ${saveResponse.mongo?.database}.${saveResponse.mongo?.collection}`,
          storeName,
        });
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setStats((current) => ({
          ...current,
          mongoStatus: `MongoDB error: ${error.message}`,
        }));
      }
    }

    loadProductPageData();

    return () => {
      isMounted = false;
    };
  }, [authenticatedFetch]);

  return (
    <Page fullWidth title="Products">
      <div className="products-page">
        <Layout>
          <Layout.Section oneThird>
            <Card>
              <div className="stat-card">
                <p className="text-medium">Total Orders</p>
                <h2 className="h3">{stats.totalOrders}</h2>
              </div>
            </Card>
          </Layout.Section>
          <Layout.Section oneThird>
            <Card>
              <div className="stat-card">
                <p className="text-medium">Saved Orders to MongoDB</p>
                <h2 className="h3">{stats.savedOrders}</h2>
              </div>
            </Card>
          </Layout.Section>
          <Layout.Section oneThird>
            <Card>
              <div className="stat-card">
                <p className="text-medium">Total Products</p>
                <h2 className="h3">{stats.totalProducts}</h2>
              </div>
            </Card>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <div className="details-card">
                <p className="text-medium"><strong>Store:</strong> {stats.storeName || "Loading..."}</p>
                <p className="text-medium"><strong>Total orders:</strong> {stats.totalOrders}</p>
                <p className="text-medium"><strong>Saved orders to MongoDB:</strong> {stats.savedOrders}</p>
                <p className="text-medium"><strong>Status:</strong> {stats.storeName + " Connected to LionEx Courier"}</p>
              </div>
            </Card>
          </Layout.Section>
        </Layout>
      </div>
    </Page>
  );
}

export default Products;
