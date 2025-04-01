package main

import (
	"fmt"
	"log"
	"net"
	"strings"

	"github.com/miekg/dns"
)

var dhtCache = map[string]string{
	"example.com.": "192.168.1.100",
}

func handleDNSQuery(w dns.ResponseWriter, r *dns.Msg) {
  fmt.Println("Here");
	m := new(dns.Msg)
	m.SetReply(r)

	for _, q := range r.Question {
		fmt.Println("DNS Query for:", q.Name)

		if peerIP, found := dhtCache[q.Name]; found {
			fmt.Println("Serving from cache:", peerIP)
			rr, _ := dns.NewRR(fmt.Sprintf("%s A %s", q.Name, peerIP))
			m.Answer = append(m.Answer, rr)
		} else {
			resolvedIP, err := net.LookupHost(strings.TrimSuffix(q.Name, "."))
			if err == nil && len(resolvedIP) > 0 {
				fmt.Println("Resolving from the internet:", resolvedIP[0])
				rr, _ := dns.NewRR(fmt.Sprintf("%s A %s", q.Name, resolvedIP[0]))
				m.Answer = append(m.Answer, rr)
			} else {
				fmt.Println("DNS resolution failed for:", q.Name)
			}
		}
	}

	w.WriteMsg(m)
}

func main() {
	server := &dns.Server{Addr: ":8000", Net: "udp"}
	dns.HandleFunc(".", handleDNSQuery)

	fmt.Println("Custom DNS Resolver Running on Port 53")
	log.Fatal(server.ListenAndServe())
}

