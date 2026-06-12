"use client";

import {
  createContext,
  useContext,
  type ComponentProps,
  type ReactNode,
} from "react";
import PhoneInput, { type Country, type Value } from "react-phone-number-input";

// Resolved once in the root layout from the request geo (Vercel/Cloudflare
// header), defaulting to Canada. Lets every PhoneField default to the visitor's
// country without threading a prop through each page/form.
const DefaultCountryContext = createContext<string>("CA");

export function CountryProvider({
  country,
  children,
}: {
  country: string;
  children: ReactNode;
}) {
  return (
    <DefaultCountryContext.Provider value={country}>
      {children}
    </DefaultCountryContext.Provider>
  );
}

// Typed explicitly rather than derived from the library's props: its
// `DefaultInputComponentProps` is an `any` index signature, which collapses
// `onChange`/`value` to `any` through Omit and breaks call-site inference. The
// phone value is a string everywhere in the app; we cast to the lib's branded
// `Value` only at the PhoneInput boundary.
type PhoneFieldProps = {
  id?: string;
  name?: string;
  value?: string;
  onChange: (value?: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  "aria-invalid"?: ComponentProps<"input">["aria-invalid"];
  /** Override the geo-resolved default country (rarely needed). */
  defaultCountry?: string;
};

/**
 * Shared phone-number input. Centralizes the default country (the request's
 * geo, via CountryProvider, falling back to Canada) and the common props
 * (`international`, `autoComplete`) so every form stays consistent. Styling is
 * global (`react-phone-number-input/style.css` + overrides in globals.css).
 */
export function PhoneField({
  defaultCountry,
  value,
  onChange,
  ...rest
}: PhoneFieldProps) {
  const geoCountry = useContext(DefaultCountryContext);
  return (
    <PhoneInput
      {...rest}
      value={value as Value | undefined}
      onChange={onChange as (value?: Value) => void}
      international
      autoComplete="tel"
      defaultCountry={(defaultCountry ?? geoCountry) as Country}
    />
  );
}
