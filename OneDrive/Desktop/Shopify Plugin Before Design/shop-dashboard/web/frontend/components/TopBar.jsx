import React, { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuthenticatedFetch } from '../hooks/useAuthenticatedFetch.js'

export function TopBar() {
  const [storeName, setStoreName] = useState("");
  const authenticatedFetch = useAuthenticatedFetch();

  useEffect(() => {
    let isMounted = true;

    async function fetchStoreInfo() {
      try {
        const request = await authenticatedFetch("/api/store/info", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        const response = await request.json();

        if (!request.ok || !response.success) {
          throw new Error(response.error || "Failed to load store information");
        }

        const nextStoreName =
          response.data?.name || response.data?.myshopifyDomain || "";

        if (isMounted) {
          setStoreName(nextStoreName);
        }
      } catch (error) {
        console.log(error);
      }
    }

    fetchStoreInfo();

    return () => {
      isMounted = false;
    };
  }, [authenticatedFetch]);

  return (
    <div className='topbar-section'>
        <div className="logo-block">
            <img className='logo' src="../assets/logo.png" alt="logo image" />
            <h1 className='text-bold h4'>{storeName}</h1>
            <NavLink to="/"> Home </NavLink>
            <NavLink to="/products">Orders</NavLink>
        </div>
    </div>
  )
}
