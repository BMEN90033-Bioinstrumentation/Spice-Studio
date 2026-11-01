*
*ZETEX  ZXMP3A17G Spice model v1.0 Last Revision 23/7/04
*
.SUBCKT ZXMP3A17G 3 4 5
*                D G S
M1 6 2 5 5 Pmod
M2 5 2 5 6 Nmod
RG 4 2 7
RIN 2 5 1E9
RD 3 6 Rdmod 0.017
RL 3 5 3E9
C1 2 5 25E-12
C2 3 4 15E-12
D1 3 5  Dbodymod
.MODEL Pmod PMOS (LEVEL=3 TOX=5.5E-8 NSUB=1E17 L=1.2E-6 W=1 
+VTO=-1.75 KP=.9E-5 RS=.025 NFS=2E11 KAPPA=0.06 UO=650 IS=1E-15 N=10)
.MODEL Nmod NMOS (LEVEL=3 TOX=5.5E-8 NSUB=2E16 L=1.4E-6 W=0.57 
+TPG=-1 IS=1E-15 N=10)
.MODEL Dbodymod D (IS=0.8E-12 RS=.015 IKF=0.1 TRS1=1.5e-3
+CJO=65e-12  BV=33)
.MODEL Rdmod RES (TC1=5.5e-3 TC2=1.5E-5)
.ENDS   ZXMP3A17G
*$
*
*                          (C)  2004 ZETEX PLC
*
*   The copyright in this model  and  the design embodied belong to
*   Zetex PLC ("Zetex"). It is supplied free of charge by Zetex for
*   the purpose  of research  and design  and may be used or copied
*   intact (including this notice) for that purpose only. All other
*   rights  are  reserved.  The model  is believed  accurate but no
*   condition or warranty as to its  merchantability or fitness for
*   purpose  is  given  and  no liability  in respect of any use is
*   accepted by Zetex PLC, its distributors or agent.
*
*
*   Zetex PLC, Fields New Road, Chadderton, Oldham  OL9 8NP
