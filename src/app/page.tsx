import { Suspense } from "react";
import { BookingForm } from "@/components/BookingForm";
import { Peony } from "@/components/Peony";
import { Artist, Work, WorkSkeleton } from "@/components/PortfolioSections";
import { site } from "@/lib/site";

export default function Home() {
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="nav">
        <a className="nav-mark" href="#top">Angel</a>
        <nav aria-label="Main">
          <a href="#work">Work</a>
          <a href="#about">About</a>
          <a className="nav-cta" href="#book">Book</a>
        </nav>
      </header>

      <main id="main">
        <div className="pre-book">
        <section className="hero" id="top">
          <Peony className="hero-peony" />
          <div className="hero-copy">
            <p className="eyebrow hero-in" style={{ "--d": "0.1s" } as React.CSSProperties}>Tattoo artist · {site.location}</p>
            <h1 className="hero-in" style={{ "--d": "0.25s" } as React.CSSProperties}>
              <span>Tattooist</span> <em>Angel</em>
            </h1>
            <p className="hero-sub hero-in" style={{ "--d": "0.4s" } as React.CSSProperties}>
              Fine line tattoos and black and grey realism, drawn for your skin and your story.
            </p>
            <div className="hero-actions hero-in" style={{ "--d": "0.55s" } as React.CSSProperties}>
              <a className="btn btn-blush" href="#book">Request a tattoo</a>
              <a className="btn btn-outline" href={site.instagramUrl} target="_blank" rel="noreferrer">Visit Instagram</a>
            </div>
          </div>
        </section>

        <section className="section" id="work" aria-labelledby="work-title">
          <div className="section-head">
            <p className="eyebrow">Recent work</p>
            <h2 className="section-title" id="work-title">From the <em>sketchbook</em> to skin.</h2>
          </div>
          <Suspense fallback={<WorkSkeleton />}>
            <Work />
          </Suspense>
        </section>

        <section className="section section-about" id="about" aria-labelledby="about-title">
          <Suspense fallback={<div className="artist artist-skeleton" role="status" aria-label="Loading artist profile" />}>
            <Artist />
          </Suspense>
        </section>
        {/* Sticky within .pre-book only, so it can never cover the form. */}
        <a className="mobile-cta" href="#book">Request a tattoo</a>
        </div>

        <section className="book" id="book" aria-labelledby="book-title">
          <div className="book-inner">
            <div className="book-intro">
              <p className="eyebrow">Booking inquiry</p>
              <h2 className="section-title" id="book-title">Tell Angel what you <em>have in mind.</em></h2>
              <p className="lede">The more detail you share, the better Angel can judge fit, time and cost.</p>
              <ol className="book-steps">
                <li><strong>Send your idea.</strong> This form goes straight to Angel.</li>
                <li><strong>Hear back by email.</strong> Usually within {site.responseTime}, if the project is a fit.</li>
                <li><strong>Lock in a date.</strong> Your appointment is only confirmed once you and Angel agree on the details.</li>
              </ol>
            </div>
            <BookingForm />
          </div>
        </section>
      </main>

      <footer className="footer">
        <p className="footer-mark">Angel</p>
        <p>{site.specialties}<br />{site.location}</p>
        <a className="text-link" href={site.instagramUrl} target="_blank" rel="noreferrer">@{site.handle}</a>
      </footer>
    </>
  );
}
