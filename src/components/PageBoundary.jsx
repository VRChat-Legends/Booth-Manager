import { Component } from "react";
import { RefreshCw } from "lucide-react";

export default class PageBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="empty-state page" role="alert"><h2>This page could not be displayed</h2><p>Your session is still connected. Retry this page or choose another tool from the sidebar.</p><button className="primary" onClick={() => this.setState({ failed: false })}><RefreshCw size={15} />Retry page</button></div>;
    return this.props.children;
  }
}